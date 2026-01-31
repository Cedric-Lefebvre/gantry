# Gantry App Updates - January 31, 2026

## Changes Made

### 1. **Logging System Added** ✅
- Created `src/utils/logger.ts` - Client-side logger that writes to localStorage
- Logs are automatically persisted and can hold up to 500 entries
- Console logs are also displayed for real-time debugging

### 2. **Logs Viewer Page Added** ✅
- Created `src/pages/Logs.tsx` - New page to view, filter, and clear logs
- Added to sidebar navigation with FileText icon
- Features:
  - Real-time log updates (refreshes every 2 seconds)
  - Filter by log level (all, error, warn, info)
  - Clear logs button
  - Shows log count and details

### 3. **Enhanced Devices Page** ✅
- Now shows:
  - System information: CPU cores, CPU usage %, Memory total, Memory used
  - Block devices in a collapsible tree view (as before)
- Loads data from all three system commands in parallel
- Better error handling and logging

### 4. **Fixed Processes Page** ✅
- Added comprehensive error handling
- Memory values now converted to MB (from bytes)
- Improved table formatting with hover effects
- CPU usage shows percentage
- Better error logging

### 5. **Repositories Page Enhanced** ✅
- Added info banner explaining toggles are UI-only
- Better logging when toggling repositories
- Includes note that actual system changes require manual editing

### 6. **API Layer Enhanced** ✅
- Added logging to all API calls in `src/api/system.ts`
- Each call logs success or failure with relevant data
- Helps trace issues from frontend through to backend

### 7. **Type Safety** ✅
- Updated all type definitions for new 'logs' page
- Updated Layout.tsx and Sidebar.tsx types
- All routes properly typed

## How to Use the Logs

1. Click on "Logs" in the sidebar
2. Watch the logs update in real-time as you interact with the app
3. Use filters to focus on errors or specific log levels
4. Click "Refresh" to manually update logs
5. Click "Clear" to reset all logs

## Issues Being Debugged

- **Processes Page Crash**: Check Logs page for error details. The page now has proper error handling.
- **Devices Page**: Now shows CPU, Memory stats at the top, and disk devices below
- **Repository Toggles**: UI-only preview (not persisted to system). This is intentional.

## What's Logged

- API command calls (success/failure)
- Page data loads with counts
- Repository toggles with state changes
- Errors with full error messages
- Debug events from all pages

## Next Steps

If you see errors:
1. Navigate to Logs page
2. Filter by "error" to see what went wrong
3. Look for the specific API call that failed
4. Check if Tauri backend is responding
5. Check browser console (F12) for additional details
