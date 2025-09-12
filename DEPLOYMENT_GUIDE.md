# DB Manager - Single Click Deployment Guide

## 🚀 Quick Start

Your DB Manager project now has **single-click deployment** capabilities! The application will run on **port 3001** to avoid conflicts with other development projects.

## 📱 Available Options

### Option 1: Desktop App (Recommended)
A clickable application has been created on your desktop:
- **Location**: `~/Desktop/DB Manager Launcher.app`
- **Usage**: Simply double-click the app icon
- **Features**: 
  - Automatic deployment on port 3001
  - Opens browser automatically
  - Shows notifications for status updates
  - Runs in Terminal for easy monitoring

### Option 2: Shell Script
A shell script is available in your project directory:
- **Location**: `./deploy-and-open.sh`
- **Usage**: Double-click or run `./deploy-and-open.sh` in terminal
- **Features**: Same as desktop app but runs directly in terminal

### Option 3: NPM Scripts
New npm scripts have been added to package.json:
```bash
npm run dev:3001      # Start development server on port 3001
npm run start:3001    # Start production server on port 3001
npm run deploy        # Run the deployment script
```

## 🔧 Configuration

### Port Configuration
- **Default Port**: 3005 (configurable in `deploy-and-open.sh`)
- **URL**: http://localhost:3005
- **Browser**: Opens in Firefox (better localhost support than Safari)
- **Conflict Resolution**: Automatically kills existing processes on port 3005

### Customization
To change the port, edit the `PORT` variable in `deploy-and-open.sh`:
```bash
PORT=3006  # Change to your preferred port
```

## 🎯 What Happens When You Click

1. **Dependency Check**: Verifies Node.js and npm are installed
2. **Port Cleanup**: Kills any existing process on port 3001
3. **Dependency Installation**: Installs npm packages if needed
4. **Build Process**: Builds the project for optimal performance
5. **Server Start**: Launches the development server on port 3001
6. **Browser Launch**: Opens http://localhost:3001 in your default browser
7. **Status Updates**: Shows progress notifications (desktop app only)

## 🛠️ Troubleshooting

### Common Issues

**App won't start:**
- Ensure Node.js is installed: `node --version`
- Check if port 3001 is available: `lsof -i :3001`
- Verify script permissions: `ls -la deploy-and-open.sh`

**Permission denied:**
```bash
chmod +x deploy-and-open.sh
```

**Port already in use:**
The script automatically handles this, but you can manually kill processes:
```bash
lsof -ti:3001 | xargs kill -9
```

**Desktop app security warning:**
- Right-click the app → Open
- Or go to System Preferences → Security & Privacy → Allow

## 📁 File Structure

```
db_manager/
├── deploy-and-open.sh              # Main deployment script
├── DB Manager Launcher.applescript # AppleScript source
├── DEPLOYMENT_GUIDE.md            # This guide
└── package.json                   # Updated with new scripts
```

## 🎉 Benefits

- **No Port Conflicts**: Runs on port 3001, leaving 3000 free
- **One-Click Deployment**: No need to remember commands
- **Automatic Browser Opening**: Saves time and clicks
- **Smart Process Management**: Handles existing processes gracefully
- **Visual Feedback**: Progress indicators and notifications
- **Parallel Development**: Work on multiple projects simultaneously

## 🔄 Updates

To update the deployment configuration:
1. Edit `deploy-and-open.sh` for script changes
2. Edit `DB Manager Launcher.applescript` for app behavior
3. Recompile the app: `osacompile -o "~/Desktop/DB Manager Launcher.app" "DB Manager Launcher.applescript"`

---

**Enjoy your streamlined development workflow! 🎊**
