#define ApplicationName "Datamigrator Worker"
#define ApplicationVersion ""

[Setup]
AppId=MyProgram
AppName={#ApplicationName}
AppVersion={#ApplicationVersion}
DefaultDirName={sd}\datamigrator
DefaultGroupName={#ApplicationName}
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
Source: "worker.env.j2"; DestDir: "{tmp}";
Source: "redist\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "fluentd\fluent-package-5.2.0-x64.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "fluentd.conf"; DestDir: "{tmp}";

[Dirs]
Name: "{app}\logs"
Name: "{app}\mnt"
Name: "{app}\conf"

[Code]
var
  ConfigPage: TInputQueryWizardPage;
  ConfigControlPlaneIP: String;
  ConfigWorkerID: String;
  ConfigWorkerSecret: String;
  ConfigProjectID: String;

procedure InitializeWizard;
begin
  ConfigPage := CreateInputQueryPage(wpSelectDir,
    'Configuration Settings',
    'Please enter the required configuration details',
    'These settings are required for the Datamigrator Worker service.');

  ConfigPage.Add('Worker ID:', False);
  ConfigPage.Add('Worker Secret:', True); 
  ConfigPage.Add('Control Plane IP:', False);
  ConfigPage.Add('Project ID:', False);
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

    if Length(ConfigPage.Values[3]) < 1 then
    begin
      MsgBox('Project ID cannot be empty.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    ConfigWorkerID := ConfigPage.Values[0];
    ConfigWorkerSecret := ConfigPage.Values[1];
    ConfigControlPlaneIP := ConfigPage.Values[2];
    ConfigProjectID := ConfigPage.Values[3];
  end;
end;

function VCRedistNeedsInstall: Boolean;
begin
  Result := not RegKeyExists(HKLM, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64');
end;

function FluentPackageNeedsInstall: Boolean;
begin
  Result := not RegKeyExists(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\fluent-package');
end;

function InstallVCRedist(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  
  Log('Installing VC++ Redistributable...');
  if not Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'), 
              '/quiet /norestart', 
              '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('VC++ Redistributable installation failed with code: ' + IntToStr(ResultCode));
    MsgBox('Failed to install Visual C++ Redistributable. Fluentd may not work properly.', mbError, MB_OK);
    Result := False;
  end
  else
  begin
    Log('VC++ Redistributable installed successfully');
  end;
end;

function InstallFluentPackage(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  
  Log('Installing fluent-package...');
  if not Exec('msiexec.exe', 
              '/i "' + ExpandConstant('{tmp}\fluent-package-5.2.0-x64.msi') + '" /quiet /norestart', 
              '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('fluent-package installation failed with code: ' + IntToStr(ResultCode));
    MsgBox('Failed to install fluent-package.', mbError, MB_OK);
    Result := False;
  end
  else
  begin
    Log('fluent-package installed successfully');
    Sleep(3000);
  end;
end;

procedure CreateFluentdConfig();
var
  ConfigContent: AnsiString;
  ConfigFile: String;
  TemplateFile: String;
  TempContent: String;
begin
  TemplateFile := ExpandConstant('{tmp}\fluentd.conf');
  ConfigFile := 'C:\opt\fluent\etc\fluent\fluentd.conf';
  
  Log('Creating Fluentd configuration from template...');
  
  if not LoadStringFromFile(TemplateFile, ConfigContent) then
  begin
    Log('Failed to read Fluentd config template from: ' + TemplateFile);
    MsgBox('Failed to read Fluentd configuration template.', mbError, MB_OK);
    Exit;
  end;
  
  TempContent := String(ConfigContent);
  StringChangeEx(TempContent, '{{WORKER_ID}}', ConfigWorkerID, True);
  StringChangeEx(TempContent, '{{CONTROL_PLANE_IP}}', ConfigControlPlaneIP, True);
  
  if not SaveStringToFile(ConfigFile, AnsiString(TempContent), False) then
  begin
    Log('Failed to create Fluentd configuration file at: ' + ConfigFile);
    MsgBox('Failed to create Fluentd configuration.', mbError, MB_OK);
  end
  else
  begin
    Log('Fluentd configuration created successfully at: ' + ConfigFile);
  end;
end;

procedure CreateVersionsConfig();
var
  VersionsContent: AnsiString;
  VersionsFile: String;
begin
  VersionsFile := ExpandConstant('{app}\conf\versions.conf');
  
  Log('Creating versions configuration at: ' + VersionsFile);
  
  VersionsContent := 'current_version={#ApplicationVersion}';
  
  if not SaveStringToFile(VersionsFile, VersionsContent, False) then
  begin
    Log('Failed to create versions configuration file at: ' + VersionsFile);
    MsgBox('Failed to create versions configuration.', mbError, MB_OK);
  end
  else
  begin
    Log('Versions configuration created successfully with version: {#ApplicationVersion}');
  end;
end;

function StartFluentdService(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;
  
  Log('Starting fluentdwinsvc service...');
  if not Exec('net.exe', 'start fluentdwinsvc', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Log('Failed to start fluentdwinsvc service with code: ' + IntToStr(ResultCode));
    MsgBox('fluentdwinsvc installed but failed to start automatically. ' + #13#10 + 
           'You can start it manually from Windows Services or by running: net start fluentdwinsvc', 
           mbInformation, MB_OK);
    Result := False;
  end
  else
  begin
    Log('fluentdwinsvc service started successfully');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Log('Stopping fluentdwinsvc service (keeping fluent-package installed)...');
    Exec('net.exe', 'stop fluentdwinsvc', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Log('Fluentd service stopped. Fluentd remains installed for future worker installations.');
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
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\binary\.env');
    TemplatePath := ExpandConstant('{tmp}\worker.env.j2');
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
      'CONTROL_PLANE_IP=' + ConfigControlPlaneIP + #13#10 +
      'REDIS_HOST=' + ConfigControlPlaneIP + #13#10 +
      'REDIS_USERNAME=default' + #13#10 +
      'REDIS_PASSWORD=welcome' + #13#10 +
      'BASE_WORKING_PATH=''C:\datamigrator\mnt''' + #13#10 +
      'PROJECT_ID=' + ConfigProjectID;

    if not SaveStringToFile(ConfigPath, EnvContent, False) then
    begin
      Log('Failed to create configuration file.');
      MsgBox('Failed to create the configuration file.', mbError, MB_OK);
    end
    else
    begin
      Log('Configuration file created successfully');
    end;

    CreateVersionsConfig();

    // Install prerequisites and fluent-package
    if VCRedistNeedsInstall then
      InstallVCRedist();
      
    if FluentPackageNeedsInstall then
    begin
      Log('fluent-package not found, installing...');
      if InstallFluentPackage then
      begin
        CreateFluentdConfig();
        StartFluentdService();
      end;
    end
    else
    begin
      Log('fluent-package is already installed, updating configuration...');
      
      // Check if service is running
      if Exec('sc.exe', 'query fluentdwinsvc', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      begin
        if ResultCode = 0 then
        begin
          Log('fluentdwinsvc service is running, stopping it...');
          if not Exec('net.exe', 'stop fluentdwinsvc', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
          begin
            Log('Failed to stop fluentdwinsvc service with code: ' + IntToStr(ResultCode));
          end
          else
          begin
            Log('fluentdwinsvc service stopped successfully');
          end;
          Sleep(2000);
        end
        else
        begin
          Log('fluentdwinsvc service is not running');
        end;
      end
      else
      begin
        Log('Could not query fluentdwinsvc service status, attempting to stop anyway...');
        Exec('net.exe', 'stop fluentdwinsvc', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        Sleep(2000);
      end;

      CreateFluentdConfig();
      StartFluentdService();
    end;

    Sleep(2000);
    MsgBox('Datamigrator Worker and Fluentd installed successfully.' + #13#10 + 
           'Worker logs will be forwarded to Control Plane at ' + ConfigControlPlaneIP, 
           mbInformation, MB_OK);
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