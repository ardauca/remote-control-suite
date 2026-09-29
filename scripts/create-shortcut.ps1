$wsh = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcut = $wsh.CreateShortcut("$desktopPath\Remote Control.lnk")
$shortcut.TargetPath = "C:\Users\ARDA\Desktop\Projeler\remote\publish\RemoteAgent.exe"
$shortcut.WorkingDirectory = "C:\Users\ARDA\Desktop\Projeler\remote\publish"
$shortcut.Description = "PC Remote Control Agent (iPhone)"
$shortcut.Save()
Write-Host "Shortcut created at: $desktopPath\Remote Control.lnk"
