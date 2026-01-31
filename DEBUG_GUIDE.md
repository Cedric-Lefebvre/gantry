# How to Debug the Gantry App

## Where Logs Are Stored

### 1. **In-App Logs** (Browser Storage) - Main place to check
- Click **"Logs"** in the sidebar
- See all API calls, errors, and events
- Filters: all, error, warn, info
- Persists in browser localStorage
- **This is where you see what pages logged**

### 2. **Browser Console** (F12 DevTools)
- Open app window
- Press **F12** (or Ctrl+Shift+I)
- Click **"Console"** tab
- Shows JavaScript errors and warnings
- Shows Rust error output (eprintln!)
- **This is where Rust backend errors show up**

### 3. **Terminal Output** (npm run tauri:dev)
- When you run `npm run tauri:dev` in terminal
- Shows Rust println! and eprintln! output
- Shows build warnings
- **This is where backend logging appears live**

## The Processes Page Issue

The Processes page might crash because:
1. **Permission issue** - needs to see all processes
2. **Serialization issue** - some process data can't be converted to JSON
3. **Memory issue** - too many processes causes overflow

## How to Debug

### Step 1: View In-App Logs
```
1. Open app
2. Click "Logs" in sidebar
3. Look for entries with "listProcesses"
4. See if there's an error logged
```

### Step 2: Check Browser Console
```
1. Open app
2. Press F12
3. Click "Console" tab
4. Click Processes page
5. See error message in red
```

### Step 3: Run with Terminal Output
```
cd /home/cedric/Projects/app/javascript/gantry
npm run tauri:dev
# Don't open the app window yet - watch terminal
# Now click Processes in the app
# Watch terminal for Rust error output
```

### Step 4: Try with Elevated Permissions (if needed)
```
cd /home/cedric/Projects/app/javascript/gantry
sudo npm run tauri:dev
# This gives full access to all processes
```

## What to Report

When you see an error, check:
1. **In-App Logs page** - What does it say?
2. **Browser Console (F12)** - What's the exact error?
3. **Terminal output** - Any Rust panic or error?

Then we can fix it!

## Quick Command to Run App with Logs
```bash
cd /home/cedric/Projects/app/javascript/gantry
npm run tauri:dev
# Watch terminal for output while using the app
```
