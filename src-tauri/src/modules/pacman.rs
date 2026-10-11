use super::config::Repository;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const PACMAN_CONF: &str = "/etc/pacman.conf";

const REPO_DIRECTIVES: [&str; 5] = ["Server", "Include", "SigLevel", "Usage", "CacheServer"];
const MAX_INCLUDE_DEPTH: usize = 3;

#[derive(Debug, PartialEq)]
enum Line<'a> {
    Header { name: &'a str, enabled: bool },
    Directive { key: &'a str, value: &'a str, enabled: bool },
    Other,
}

fn section_name(text: &str) -> Option<&str> {
    let name = text.strip_prefix('[')?.strip_suffix(']')?;
    if name.is_empty() || name.contains(char::is_whitespace) {
        return None;
    }
    Some(name)
}

fn repo_directive(text: &str) -> Option<(&str, &str)> {
    let (key, value) = text.split_once('=')?;
    let key = key.trim_end();
    REPO_DIRECTIVES.contains(&key).then(|| (key, value.trim()))
}

// A commented line only counts as a disabled header or directive when it is
// written the way pacman.conf ships them ("#[repo]", "#Include = ..."), so the
// indented examples in the documentation comments are left alone.
fn uncommented(text: &str) -> Option<&str> {
    let rest = text.strip_prefix('#')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

fn classify(line: &str) -> Line<'_> {
    let text = line.trim();
    let (body, enabled) = match uncommented(text) {
        Some(body) => (body, false),
        None => (text, true),
    };

    if let Some(name) = section_name(body) {
        return Line::Header { name, enabled };
    }
    if let Some((key, value)) = repo_directive(body) {
        return Line::Directive { key, value, enabled };
    }
    Line::Other
}

fn is_repo_header(name: &str) -> bool {
    name != "options"
}

struct PendingRepo {
    name: String,
    enabled: bool,
    line_number: usize,
    sources: Vec<String>,
    sig_level: String,
}

pub fn parse_conf(content: &str, file_path: &str) -> Vec<Repository> {
    let mut repos = Vec::new();
    let mut current: Option<PendingRepo> = None;

    let mut flush = |pending: Option<PendingRepo>| {
        let Some(repo) = pending else { return };
        // "#[something]" without directives below it is just a comment
        if !repo.enabled && repo.sources.is_empty() {
            return;
        }
        repos.push(Repository {
            id: format!("{}:{}", file_path, repo.line_number),
            file_path: file_path.to_string(),
            line_number: repo.line_number,
            types: "pacman".to_string(),
            uris: repo.sources.join(", "),
            suites: repo.name.clone(),
            components: repo.sig_level,
            enabled: repo.enabled,
            original_line: format!("[{}]", repo.name),
        });
    };

    for (idx, line) in content.lines().enumerate() {
        match classify(line) {
            Line::Header { name, enabled } => {
                flush(current.take());
                if is_repo_header(name) {
                    current = Some(PendingRepo {
                        name: name.to_string(),
                        enabled,
                        line_number: idx,
                        sources: Vec::new(),
                        sig_level: String::new(),
                    });
                }
            }
            Line::Directive { key, value, enabled } => {
                let Some(repo) = current.as_mut() else { continue };
                if repo.enabled != enabled {
                    if !repo.enabled {
                        flush(current.take());
                    }
                    continue;
                }
                match key {
                    "Server" | "Include" => repo.sources.push(value.to_string()),
                    "SigLevel" => repo.sig_level = value.to_string(),
                    _ => {}
                }
            }
            Line::Other => {
                if current.as_ref().is_some_and(|repo| !repo.enabled) {
                    flush(current.take());
                }
            }
        }
    }
    flush(current.take());

    repos
}

fn wildcard_match(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let name: Vec<char> = name.chars().collect();
    let (mut p, mut n) = (0, 0);
    let mut backtrack: Option<(usize, usize)> = None;

    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            backtrack = Some((p, n));
            p += 1;
        } else if let Some((star, matched)) = backtrack {
            p = star + 1;
            n = matched + 1;
            backtrack = Some((star, matched + 1));
        } else {
            return false;
        }
    }

    pattern[p..].iter().all(|c| *c == '*')
}

fn expand_include(pattern: &str) -> Vec<PathBuf> {
    let path = Path::new(pattern);
    let file_pattern = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !file_pattern.contains(['*', '?']) {
        return vec![path.to_path_buf()];
    }

    let Some(parent) = path.parent() else { return Vec::new() };
    let mut matches: Vec<PathBuf> = fs::read_dir(parent)
        .map(|dir| {
            dir.flatten()
                .map(|entry| entry.path())
                .filter(|p| p.file_name().is_some_and(|n| wildcard_match(&file_pattern, &n.to_string_lossy())))
                .collect()
        })
        .unwrap_or_default();
    matches.sort();
    matches
}

// Include directives outside of a repository section pull in whole config
// files, which may define repositories of their own.
fn top_level_includes(content: &str) -> Vec<String> {
    let mut includes = Vec::new();
    let mut in_repo = false;

    for line in content.lines() {
        match classify(line) {
            Line::Header { name, enabled: true } => in_repo = is_repo_header(name),
            Line::Directive { key: "Include", value, enabled: true } if !in_repo => {
                includes.push(value.to_string());
            }
            _ => {}
        }
    }

    includes
}

fn collect_config_files(path: &Path, depth: usize, seen: &mut HashSet<PathBuf>, files: &mut Vec<(PathBuf, String)>) {
    if depth > MAX_INCLUDE_DEPTH || !seen.insert(path.to_path_buf()) {
        return;
    }
    let Ok(content) = fs::read_to_string(path) else { return };

    let includes = top_level_includes(&content);
    files.push((path.to_path_buf(), content));

    for pattern in includes {
        for included in expand_include(&pattern) {
            collect_config_files(&included, depth + 1, seen, files);
        }
    }
}

fn config_files() -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    collect_config_files(Path::new(PACMAN_CONF), 0, &mut HashSet::new(), &mut files);
    files
}

pub fn list_repos() -> Vec<Repository> {
    config_files()
        .iter()
        .flat_map(|(path, content)| parse_conf(content, &path.to_string_lossy()))
        .collect()
}

/// Splits a repository id into its config file and header line, refusing any
/// file that is not part of the pacman configuration.
pub fn resolve_id(id: &str) -> Result<(String, usize), String> {
    let (file_path, line) = id.rsplit_once(':').ok_or("Invalid repository ID")?;
    let line_number: usize = line.parse().map_err(|_| "Invalid line number")?;

    let known = config_files().iter().any(|(path, _)| path.as_path() == Path::new(file_path));
    if !known {
        return Err("Repository file is not part of the pacman configuration".to_string());
    }

    Ok((file_path.to_string(), line_number))
}

fn repo_header_at<'a>(lines: &[&'a str], line_number: usize) -> Result<(&'a str, bool), String> {
    match lines.get(line_number).map(|line| classify(line)) {
        Some(Line::Header { name, enabled }) if is_repo_header(name) => Ok((name, enabled)),
        _ => Err("Repository not found, the configuration changed on disk. Refresh and try again.".to_string()),
    }
}

fn comment_out(line: &str) -> String {
    format!("#{}", line.trim())
}

fn uncomment(line: &str) -> String {
    let text = line.trim();
    uncommented(text).unwrap_or(text).to_string()
}

fn join_lines(lines: Vec<String>) -> String {
    let mut content = lines.join("\n");
    content.push('\n');
    content
}

pub fn set_enabled(content: &str, line_number: usize, enabled: bool) -> Result<String, String> {
    let lines: Vec<&str> = content.lines().collect();
    let (_, currently_enabled) = repo_header_at(&lines, line_number)?;

    let mut result: Vec<String> = lines.iter().map(|line| line.to_string()).collect();
    if currently_enabled == enabled {
        return Ok(join_lines(result));
    }

    result[line_number] = if enabled { uncomment(lines[line_number]) } else { comment_out(lines[line_number]) };

    for (idx, line) in lines.iter().enumerate().skip(line_number + 1) {
        match classify(line) {
            Line::Header { .. } => break,
            Line::Directive { enabled: directive_enabled, .. } => {
                if enabled && !directive_enabled {
                    result[idx] = uncomment(line);
                } else if !enabled && directive_enabled {
                    result[idx] = comment_out(line);
                }
            }
            // An enabled section runs until the next header, a disabled one is
            // only the block of commented directives right below its header.
            Line::Other => {
                if enabled {
                    break;
                }
            }
        }
    }

    Ok(join_lines(result))
}

pub fn remove_repo(content: &str, line_number: usize) -> Result<String, String> {
    let lines: Vec<&str> = content.lines().collect();
    let (_, header_enabled) = repo_header_at(&lines, line_number)?;

    let mut removed: HashSet<usize> = HashSet::from([line_number]);
    for (idx, line) in lines.iter().enumerate().skip(line_number + 1) {
        match classify(line) {
            Line::Header { .. } => break,
            Line::Directive { enabled, .. } => {
                if header_enabled || !enabled {
                    removed.insert(idx);
                } else {
                    break;
                }
            }
            Line::Other => {
                if !header_enabled {
                    break;
                }
            }
        }
    }

    let mut result: Vec<String> = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        if removed.contains(&idx) {
            continue;
        }
        let follows_removed = idx > 0 && removed.contains(&(idx - 1));
        let doubled_blank = line.trim().is_empty() && result.last().is_none_or(|prev| prev.trim().is_empty());
        if follows_removed && doubled_blank {
            continue;
        }
        result.push(line.to_string());
    }

    Ok(join_lines(result))
}

/// Appends a repository block ("[name]" followed by its directives) to the
/// configuration after validating it.
pub fn append_repo(content: &str, block: &str, existing_names: &[String]) -> Result<String, String> {
    let block_lines: Vec<&str> = block.lines().map(str::trim).filter(|line| !line.is_empty()).collect();

    let name = block_lines
        .first()
        .and_then(|line| section_name(line))
        .ok_or("Repository must start with its name in brackets, e.g. [myrepo]")?;

    let valid_name = name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.+@".contains(c));
    if !valid_name || !is_repo_header(name) {
        return Err(format!("Invalid repository name: {}", name));
    }
    if existing_names.iter().any(|existing| existing == name) {
        return Err(format!("Repository [{}] already exists", name));
    }

    let mut has_source = false;
    for line in &block_lines[1..] {
        match classify(line) {
            Line::Directive { key, value, enabled: true } if !value.is_empty() => {
                has_source |= key == "Server" || key == "Include";
            }
            _ => {
                return Err(format!(
                    "Invalid line: {}. Expected one of {} followed by = value",
                    line,
                    REPO_DIRECTIVES.join(", ")
                ));
            }
        }
    }
    if !has_source {
        return Err("Repository needs at least one Server or Include line".to_string());
    }

    let mut result: Vec<String> = content.lines().map(|line| line.to_string()).collect();
    if result.last().is_some_and(|line| !line.trim().is_empty()) {
        result.push(String::new());
    }
    result.extend(block_lines.iter().map(|line| line.to_string()));

    Ok(join_lines(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
[options]
HoldPkg     = pacman glibc
Architecture = auto
SigLevel    = Required DatabaseOptional

# Repository entries are of the format:
#       [repo-name]
#       Server = ServerName
#       Include = IncludePath

[cachyos]
Include = /etc/pacman.d/cachyos-mirrorlist

#[core-testing]
#Include = /etc/pacman.d/mirrorlist

[core]
Include = /etc/pacman.d/mirrorlist

# An example of a custom package repository.
#[custom]
#SigLevel = Optional TrustAll
#Server = file:///home/custompkgs
";

    fn names(repos: &[Repository]) -> Vec<(&str, bool)> {
        repos.iter().map(|r| (r.suites.as_str(), r.enabled)).collect()
    }

    fn line_of(content: &str, header: &str) -> usize {
        content.lines().position(|l| l.trim() == header).expect("header should exist")
    }

    #[test]
    fn test_parse_conf_lists_enabled_and_disabled_repos() {
        let repos = parse_conf(SAMPLE, PACMAN_CONF);
        assert_eq!(
            names(&repos),
            vec![("cachyos", true), ("core-testing", false), ("core", true), ("custom", false)]
        );
        assert_eq!(repos[0].uris, "/etc/pacman.d/cachyos-mirrorlist");
        assert_eq!(repos[0].id, format!("{}:10", PACMAN_CONF));
        assert_eq!(repos[3].uris, "file:///home/custompkgs");
        assert_eq!(repos[3].components, "Optional TrustAll");
    }

    #[test]
    fn test_parse_conf_ignores_options_and_documentation() {
        let repos = parse_conf(SAMPLE, PACMAN_CONF);
        assert!(repos.iter().all(|r| r.suites != "options" && r.suites != "repo-name"));
        assert!(repos.iter().all(|r| r.components != "Required DatabaseOptional"));
    }

    #[test]
    fn test_disable_then_enable_round_trips() {
        let line = line_of(SAMPLE, "[core]");
        let disabled = set_enabled(SAMPLE, line, false).unwrap();
        assert!(disabled.contains("#[core]\n#Include = /etc/pacman.d/mirrorlist\n"));
        assert_eq!(
            names(&parse_conf(&disabled, PACMAN_CONF)),
            vec![("cachyos", true), ("core-testing", false), ("core", false), ("custom", false)]
        );

        let enabled = set_enabled(&disabled, line, true).unwrap();
        assert_eq!(enabled, SAMPLE);
    }

    #[test]
    fn test_enable_uncomments_whole_block() {
        let line = line_of(SAMPLE, "#[custom]");
        let enabled = set_enabled(SAMPLE, line, true).unwrap();
        assert!(enabled.ends_with("[custom]\nSigLevel = Optional TrustAll\nServer = file:///home/custompkgs\n"));
        assert!(enabled.contains("# An example of a custom package repository.\n"));
    }

    #[test]
    fn test_disable_leaves_other_sections_untouched() {
        let line = line_of(SAMPLE, "[cachyos]");
        let disabled = set_enabled(SAMPLE, line, false).unwrap();
        assert!(disabled.contains("\n[core]\nInclude = /etc/pacman.d/mirrorlist\n"));
        assert!(disabled.contains("HoldPkg     = pacman glibc"));
    }

    #[test]
    fn test_set_enabled_rejects_stale_line() {
        assert!(set_enabled(SAMPLE, 0, false).is_err(), "[options] is not a repository");
        assert!(set_enabled(SAMPLE, 1, false).is_err());
        assert!(set_enabled(SAMPLE, 999, false).is_err());
    }

    #[test]
    fn test_remove_repo() {
        let removed = remove_repo(SAMPLE, line_of(SAMPLE, "[core]")).unwrap();
        assert_eq!(
            names(&parse_conf(&removed, PACMAN_CONF)),
            vec![("cachyos", true), ("core-testing", false), ("custom", false)]
        );
        assert!(!removed.contains("\n\n\n"), "should not leave doubled blank lines");
        assert!(removed.contains("# An example of a custom package repository.\n#[custom]"));
    }

    #[test]
    fn test_remove_disabled_repo_keeps_following_lines() {
        let removed = remove_repo(SAMPLE, line_of(SAMPLE, "#[core-testing]")).unwrap();
        assert_eq!(
            names(&parse_conf(&removed, PACMAN_CONF)),
            vec![("cachyos", true), ("core", true), ("custom", false)]
        );
    }

    #[test]
    fn test_remove_repo_with_comment_between_directives() {
        let conf = "[options]\nArchitecture = auto\n\n[foo]\n# primary\nServer = https://a.example/$repo\n\n[bar]\nServer = https://b.example\n";
        let removed = remove_repo(conf, 3).unwrap();
        assert!(!removed.contains("a.example"), "no directive may leak into the previous section");
        assert_eq!(names(&parse_conf(&removed, PACMAN_CONF)), vec![("bar", true)]);
    }

    #[test]
    fn test_append_repo() {
        let existing = vec!["core".to_string()];
        let block = "[myrepo]\nSigLevel = Optional\nServer = https://example.com/$repo/$arch\n";
        let result = append_repo(SAMPLE, block, &existing).unwrap();
        assert!(result.ends_with("\n\n[myrepo]\nSigLevel = Optional\nServer = https://example.com/$repo/$arch\n"));
        let repos = parse_conf(&result, PACMAN_CONF);
        assert_eq!(repos.last().map(|r| (r.suites.as_str(), r.enabled)), Some(("myrepo", true)));
    }

    #[test]
    fn test_append_repo_validation() {
        let existing = vec!["core".to_string()];
        assert!(append_repo(SAMPLE, "Server = https://example.com", &existing).is_err());
        assert!(append_repo(SAMPLE, "[core]\nServer = https://example.com", &existing).is_err());
        assert!(append_repo(SAMPLE, "[options]\nServer = https://example.com", &existing).is_err());
        assert!(append_repo(SAMPLE, "[myrepo]", &existing).is_err());
        assert!(append_repo(SAMPLE, "[myrepo]\nSigLevel = Never", &existing).is_err());
        assert!(append_repo(SAMPLE, "[myrepo]\nServer = https://example.com\nHoldPkg = pacman", &existing).is_err());
        assert!(append_repo(SAMPLE, "[myrepo]\nServer = https://example.com\n[other]", &existing).is_err());
        assert!(append_repo(SAMPLE, "[my/repo]\nServer = https://example.com", &existing).is_err());
    }

    #[test]
    fn test_top_level_includes() {
        let conf = "[options]\nInclude = /etc/pacman.d/*.conf\n\n[core]\nInclude = /etc/pacman.d/mirrorlist\n";
        assert_eq!(top_level_includes(conf), vec!["/etc/pacman.d/*.conf"]);
    }

    #[test]
    fn test_wildcard_match() {
        assert!(wildcard_match("*.conf", "chaotic.conf"));
        assert!(wildcard_match("repo-?.conf", "repo-1.conf"));
        assert!(wildcard_match("*", "anything"));
        assert!(!wildcard_match("*.conf", "mirrorlist"));
        assert!(!wildcard_match("repo-?.conf", "repo-12.conf"));
    }
}
