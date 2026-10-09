#include "..\.tmp\packaging\version.iss"
#define AppGuid "{E24A2DF4-6D43-4724-B596-8647C759912B}"

[Setup]
AppId={{E24A2DF4-6D43-4724-B596-8647C759912B}
AppName=桌屿 DeskIsland
AppVersion={#AppVersion}
AppVerName=桌屿 DeskIsland {#AppVersion}
DefaultDirName={sd}\DeskIsland
AppendDefaultDirName=yes
UsePreviousAppDir=yes
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DefaultGroupName=桌屿 DeskIsland
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=DeskIsland-{#AppVersion}-Setup
SetupIconFile=..\dist\win-x64\DeskIsland.ico
UninstallDisplayIcon={app}\DeskIsland.ico
Compression=lzma2
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
WizardStyle=modern

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "..\dist\win-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*"

[Icons]
Name: "{userprograms}\桌屿 DeskIsland"; Filename: "{app}\DeskIsland.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeskIsland.ico"
Name: "{userdesktop}\桌屿 DeskIsland"; Filename: "{app}\DeskIsland.exe"; WorkingDir: "{app}"; IconFilename: "{app}\DeskIsland.ico"

[Run]
Filename: "{app}\DeskIsland.exe"; Description: "启动桌屿"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\data"

[Code]
var PreviousDirectory: String;

function NormalizeDirectory(Value: String): String;
begin
  Value := RemoveBackslashUnlessRoot(Trim(Value));
  if CompareText(ExtractFileName(Value), 'DeskIsland') <> 0 then
    Value := AddBackslash(Value) + 'DeskIsland';
  Result := Value;
end;

procedure InitializeWizard;
begin
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppGuid}_is1', 'InstallLocation', PreviousDirectory) then
  begin
    PreviousDirectory := RemoveBackslashUnlessRoot(PreviousDirectory);
    WizardForm.DirEdit.Text := PreviousDirectory;
    WizardForm.DirEdit.Enabled := False;
    WizardForm.DirBrowseButton.Enabled := False;
    WizardForm.SelectDirLabel.Caption := '检测到已安装的桌屿，将在原目录覆盖升级并保留个人数据。';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Directory: String; Probe: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if PreviousDirectory <> '' then Directory := PreviousDirectory
    else Directory := NormalizeDirectory(WizardDirValue);
    WizardForm.DirEdit.Text := Directory;
    Probe := AddBackslash(Directory) + '.deskisland-install-write-check';
    if not ForceDirectories(Directory) or not SaveStringToFile(Probe, '', False) then
    begin
      MsgBox('所选目录无法写入，请选择当前账号可写的安装路径。', mbError, MB_OK);
      Result := False;
    end
    else DeleteFile(Probe);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if PreviousDirectory <> '' then WizardForm.DirEdit.Text := PreviousDirectory
  else WizardForm.DirEdit.Text := NormalizeDirectory(WizardDirValue);
  Result := '';
  if FindWindowByWindowName('桌屿') <> 0 then
    Result := '桌屿仍在运行，请从托盘菜单选择「退出」后继续安装。';
end;

function InitializeUninstall(): Boolean;
begin
  Result := MsgBox('卸载将删除桌屿程序及 data 文件夹内的全部个人数据（磁贴布局、地区、天气凭据和缓存）。请先退出桌屿。是否继续？', mbConfirmation, MB_YESNO) = IDYES;
  if Result and (FindWindowByWindowName('桌屿') <> 0) then
  begin
    MsgBox('桌屿仍在运行，请从托盘菜单选择「退出」后重新卸载。', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Command: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'DeskIsland', Command) then
      if Pos(Lowercase(ExpandConstant('{app}\DeskIsland.exe')), Lowercase(Command)) > 0 then
      begin
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'DeskIsland');
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run', 'DeskIsland');
      end;
  end;
end;
