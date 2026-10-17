!include LogicLib.nsh
!include nsDialogs.nsh

Var PythonDialog
Var PythonCheckbox
Var PythonInstall

Page custom PythonPageCreate PythonPageLeave

Function PythonPageCreate
  !insertmacro MUI_HEADER_TEXT "Python" "Optional. YouTube import needs Python on this PC."
  nsDialogs::Create 1018
  Pop $PythonDialog
  ${If} $PythonDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 12u 100% 24u "Open the Python installer after setup (python-manager-26.4.msix)"
  Pop $PythonCheckbox
  ${NSD_SetState} $PythonCheckbox ${BST_CHECKED}
  nsDialogs::Show
FunctionEnd

Function PythonPageLeave
  ${NSD_GetState} $PythonCheckbox $PythonInstall
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ${If} $PythonInstall == ${BST_CHECKED}
    IfFileExists "$INSTDIR\python-manager-26.4.msix" 0 OrfeusPythonResource
      ExecShell "open" "$INSTDIR\python-manager-26.4.msix"
      Goto OrfeusPythonDone
    OrfeusPythonResource:
    IfFileExists "$INSTDIR\resources\python-manager-26.4.msix" 0 OrfeusPythonDone
      ExecShell "open" "$INSTDIR\resources\python-manager-26.4.msix"
    OrfeusPythonDone:
  ${EndIf}
!macroend
