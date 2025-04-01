#define MyAppName "Datamigrator Worker"
#define MyAppVersion "1.0.0"

[Setup]
AppId=MyProgram
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={sd}\datamigrator
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=.
OutputBaseFilename=datamigrator-worker-setup
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin
SetupLogging=yes


[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "worker.exe"; DestDir: "{app}\binary"; Flags: ignoreversion
Source: "winsw.exe"; DestDir: "{app}"; DestName: "DatamigratorWorker.exe"; Flags: ignoreversion
Source: "service.xml"; DestDir: "{app}"; DestName: "DatamigratorWorker.xml"; Flags: ignoreversion

[Dirs]
Name: "{app}\logs"
Name: "{app}\conf"
Name: "{app}\mnt"
Name: "{app}\bin"

[Code]
var
  ConfigPage: TInputQueryWizardPage;
  ConfigControlPlaneIP: String;
  ConfigWorkerID: String;
  ConfigWorkerSecret: String;

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Configuration Settings',
    'Please enter the required configuration details',
    'These settings are required for the Datamigrator Worker service.');

  ConfigPage.Add('Worker ID:', False);
  ConfigPage.Add('Worker Secret:', True); 
  ConfigPage.Add('Control Plane IP:', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  
  if CurPageID = ConfigPage.ID then
  begin
    if Length(ConfigPage.Values[0]) < 1 then
    begin
      MsgBox('Worker ID cannot be empty.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    if Length(ConfigPage.Values[1]) < 1 then
    begin
      MsgBox('Worker Secret cannot be empty.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    if Length(ConfigPage.Values[2]) < 1 then
    begin
      MsgBox('Control Plane IP cannot be empty.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    ConfigWorkerID := ConfigPage.Values[0];
    ConfigWorkerSecret := ConfigPage.Values[1];
    ConfigControlPlaneIP := ConfigPage.Values[2];
    
  end;
end;


procedure CurStepChanged(CurStep: TSetupStep);
var
  EnvContent: AnsiString;
  TemplateContent: AnsiString;
  TempContent: String;
  ConfigPath: String;
  TemplatePath: String;
  CountMatch: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\binary\.env');
    TemplatePath := ExpandConstant('{src}\worker.env.j2');
    Log('Creating configuration file at: ' + ConfigPath);

    if FileExists(TemplatePath) then
    begin
      if not LoadStringFromFile(TemplatePath, TemplateContent) then
      begin
        Log('Failed to read template file: ' + TemplatePath);
        MsgBox('Error reading template file.', mbError, MB_OK);
        exit;
      end;
      Log('Successfully read template file');
      TempContent := String(TemplateContent);
      CountMatch := StringChangeEx(TempContent, 'BASE_WORKING_PATH=''/mnt/datamigrator''', '', True);
      Log('Count Match is: '+ IntToStr(CountMatch));
      Log('Removed BASE_WORKING_PATH from template');
    end
    else
    begin
      Log('Template worker.env.j2 not found at: ' + TemplatePath);
      MsgBox('Template file missing.', mbError, MB_OK);
      exit;
    end;

    EnvContent := 
      TempContent + #13#10 + #13#10 +
      'WORKER_CONFIG_URL=https://' + ConfigControlPlaneIP + #13#10 +
      'WORKER_JOB_SERVICE_URL=https://' + ConfigControlPlaneIP + #13#10 +
      'WORKER_REPORT_SERVICE_URL=https://' + ConfigControlPlaneIP + #13#10 +
      'TEMPORAL_ADDRESS=' + ConfigControlPlaneIP + ':7233' + #13#10 +
      'KEYCLOAK_BASE_URL=https://' + ConfigControlPlaneIP + '/keycloak' + #13#10 +
      'WORKER_ID=' + ConfigWorkerID + #13#10 +
      'WORKER_SECRET=' + ConfigWorkerSecret + #13#10 +
      'REDIS_HOST=' + ConfigControlPlaneIP + #13#10 +
      'REDIS_USERNAME=default' + #13#10 +
      'REDIS_PASSWORD=welcome' + #13#10 +
      'REDIS_PORT=6379' + #13#10 +
      'BASE_WORKING_PATH=''C:\datamigrator\mnt''';

    if not SaveStringToFile(ConfigPath, EnvContent, False) then
    begin
      Log('Failed to create configuration file.');
      MsgBox('Failed to create the configuration file.', mbError, MB_OK);
    end
    else
    begin
      Log('Configuration file created successfully');
    end;

    Sleep(5000);

    MsgBox('Datamigrator Worker installed successfully.', mbInformation, MB_OK);
  end;
end;

[Run]
Filename: "{app}\DatamigratorWorker.exe"; Parameters: "install"; WorkingDir: "{app}"; Flags: runhidden; StatusMsg: "Installing service..."
Filename: "{app}\DatamigratorWorker.exe"; Parameters: "start"; WorkingDir: "{app}"; Flags: runhidden; StatusMsg: "Starting service...";

[UninstallRun]
Filename: "{app}\DatamigratorWorker.exe"; Parameters: "stop"; WorkingDir: "{app}"; RunOnceId: "StopService"; Flags: runhidden
Filename: "{app}\DatamigratorWorker.exe"; Parameters: "uninstall"; WorkingDir: "{app}"; RunOnceId: "UninstallService"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"