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
  EnvContent: String;
  ConfigPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    ConfigPath := ExpandConstant('{app}\binary\.env');
    Log('Creating configuration file at: ' + ConfigPath);
    
    EnvContent :=
      'NODE_TLS_REJECT_UNAUTHORIZED=0' + #13#10 +
      'KEYCLOAK_REALM=datamigrator' + #13#10 +
      '' + #13#10 +
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
      '' + #13#10 +
      '#  ----------------------------- NFS ----------------------------------#' + #13#10 +
      'NFS_WIN_LIST_PATH_CMD=''showmount -e ${HOST}''' + #13#10 +
      'NFS_LINUX_LIST_PATH_CMD=''showmount -e ${HOST}''' + #13#10 +
      'NFS_UNIX_LIST_PATH_CMD=''showmount -e ${HOST}''' + #13#10 +
      '' + #13#10 +
      'NFS_LINUX_MOUNT_PATH_CMD=''mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}''' + #13#10 +
      'NFS_UNIX_MOUNT_PATH_CMD=''mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}''' + #13#10 +
      '' + #13#10 +
      'NFS_LINUX_UNMOUNT_PATH_CMD=''umount ${DIR_PATH}''' + #13#10 +
      'NFS_UNIX_UNMOUNT_PATH_CMD=''umount ${DIR_PATH}''' + #13#10 +
      '' + #13#10 +
      'NFS_LINUX_CHECK_MOUNT_PATH_CMD=''mount | grep ${PATH}''' + #13#10 +
      'NFS_UNIX_CHECK_MOUNT_PATH_CMD=''mount | grep ${PATH}''' + #13#10 +
      '' + #13#10 +

      '#  ----------------------------- SMB ----------------------------------#' + #13#10 +
      'SMB_WIN_VALIDATE_CRED_CMD=''net use \\${HOST} /user:"${USERNAME}" "${PASSWORD}"''' + #13#10 +
      '' + #13#10 +
      'SMB_WIN_LIST_PATH_CMD=''net view ${HOST}''' + #13#10 +
      'SMB_LINUX_LIST_PATH_CMD="smbclient -L ${HOST} -U ${USERNAME}%''${PASSWORD}''"' + #13#10 +
      'SMB_UNIX_LIST_PATH_CMD="smbclient -L ${HOST} -U ${USERNAME}%''${PASSWORD}''"' + #13#10 +
      '' + #13#10 +
      'SMB_WIN_MOUNT_PATH_CMD=''net use \\${HOST}\${MOUNT_PATH} /user:"${USERNAME}" "${PASSWORD}"''' + #13#10 +
      'SMB_WIN_CREATE_LINK_PATH_CMD=''powershell.exe New-Item -ItemType SymbolicLink -Path "${DIR_PATH}" -Target "\\${HOST}\${MOUNT_PATH}"''' + #13#10 +
      'SMB_WIN_UNMOUNT_PATH_CMD=''net use \\${HOST}\${MOUNT_PATH} /delete''' + #13#10 +
      'SMB_WIN_UNLINK_PATH_CMD=''powershell.exe -Command "Remove-Item ${DIR_PATH} -Recurse -Force -Confirm:$false"''' + #13#10 +
      'SMB_LINUX_MOUNT_PATH_CMD="mount -t cifs //${HOST}${MOUNT_PATH} ${DIR_PATH} -o username=${USERNAME},password=''${PASSWORD}''"' + #13#10 +
      'SMB_UNIX_MOUNT_PATH_CMD=''mount_smbfs //${USERNAME}:${PASSWORD}@${HOST}${PATH} ${BASE_DIR}/${JOB_RUN_ID}/${PATH_ID}''' + #13#10 +
      '' + #13#10 +
      'SMB_LINUX_UNMOUNT_PATH_CMD=''umount ${DIR_PATH}''' + #13#10 +
      'SMB_UNIX_UNMOUNT_PATH_CMD=''umount ${DIR_PATH}''' + #13#10 +
      'SMB_WIN_DISCONNECT_SESSION_CMD=''net use \\${HOST} /delete''' + #13#10 +
      '' + #13#10 +

      'BASE_WORKING_PATH=''C:\datamigrator\mnt''' + #13#10 +
      '' + #13#10 +

      '#  ----------------------------- NFS With Protocol ----------------------------------#' + #13#10 +
      'NFS_LINUX_MOUNT_PATH_CMD=''mount -t nfs -o nfsvers=${PROTOCOL_VERSION} ${HOST}:${MOUNT_PATH} ${DIR_PATH}''' + #13#10 +
      'NFS_UNIX_MOUNT_PATH_CMD=''mount -t nfs -o nfsvers=${PROTOCOL_VERSION} ${HOST}:${MOUNT_PATH} ${DIR_PATH}''' + #13#10 +
      '' + #13#10 +

      '#  ----------------------------- SMB With Protocol ----------------------------------#' + #13#10 +
      'SMB_WIN_MOUNT_PATH_CMD=''net use \\${HOST}\${MOUNT_PATH} /user:"${USERNAME}" "${PASSWORD}"''' + #13#10 +
      'SMB_LINUX_MOUNT_PATH_CMD="mount -t cifs //${HOST}${MOUNT_PATH} ${DIR_PATH} -o username=${USERNAME},password=''${PASSWORD}'',vers=${PROTOCOL_VERSION}"' + #13#10 +
      'SMB_UNIX_MOUNT_PATH_CMD=''mount_smbfs -o vers=${PROTOCOL_VERSION} //${USERNAME}:${PASSWORD}@${HOST}${PATH} ${BASE_DIR}/${JOB_RUN_ID}/${PATH_ID}''';

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