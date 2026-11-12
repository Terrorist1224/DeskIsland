function ResolveShortcutDirectory(Directory: String): String;
var ExitCode: Integer; Lines: TArrayOfString; OutputPath, Parameters: String;
begin
  ExtractTemporaryFile('resolve-shortcut-directory.ps1');
  OutputPath := ExpandConstant('{tmp}\shortcut-directory.txt');
  DeleteFile(OutputPath);
  Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    AddQuotes(ExpandConstant('{tmp}\resolve-shortcut-directory.ps1')) +
    ' -Directory ' + AddQuotes(Directory) + ' -OutputPath ' + AddQuotes(OutputPath);
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters, '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    RaiseException('无法启动快捷方式目录检查。');
  if ExitCode <> 0 then RaiseException('无法解析快捷方式目录：' + Directory);
  if not LoadStringsFromFile(OutputPath, Lines) then RaiseException('无法读取快捷方式目录检查结果。');
  if GetArrayLength(Lines) <> 1 then RaiseException('快捷方式目录检查结果无效。');
  Result := Lines[0];
  if not DirExists(Result) then RaiseException('快捷方式目标目录不存在：' + Result);
  Log('Shortcut directory: ' + Directory + ' -> ' + Result);
end;
