-- DB Manager - Single Click Launcher
-- This AppleScript creates a clickable application for deploying and opening DB Manager

on run
    try
        -- Display initial notification
        display notification "Starting DB Manager deployment..." with title "DB Manager Launcher"
        
        -- Set project path
        set projectPath to "/Users/rj/work/projects/python/db_manager"
        
        -- Run the deployment script
        set shellScript to "cd " & quoted form of projectPath & " && ./deploy-and-open.sh"
        
        -- Execute the script in Terminal
        tell application "Terminal"
            activate
            set newWindow to do script shellScript
            
            -- Set window title
            set custom title of newWindow to "DB Manager - Port 3005"
        end tell
        
        -- Success notification
        display notification "DB Manager is starting up on port 3005 in Firefox!" with title "DB Manager Launcher" sound name "Glass"
        
    on error errorMessage
        -- Error notification
        display notification "Failed to start DB Manager: " & errorMessage with title "DB Manager Launcher" sound name "Basso"
        
        -- Show error dialog
        display dialog "Error starting DB Manager:" & return & return & errorMessage buttons {"OK"} default button "OK" with icon stop
    end try
end run
