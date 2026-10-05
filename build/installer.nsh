; 安装时写入开机自启（当前用户），卸载时移除
!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DesktopPetTodo" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DesktopPetTodo"
!macroend
