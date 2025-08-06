import { AclObject, ValidateMappingInput, ValidateMappingResult } from "./sid-mapping.util.type";


const escapePSString = (str: string): string => str.replace(/'/g, "''");

export const getAclScript = (sourceFile: string): string =>  `
    $path = '${escapePSString(sourceFile)}'
    Get-Acl $path | Select-Object @{
      Name='Path'; Expression={$_.Path}
    }, @{
      Name='Owner'; Expression={$_.Owner}
    }, @{
      Name='Group'; Expression={$_.Group}
    }, @{
      Name='Access'; Expression={$_.Access | ForEach-Object {
        [PSCustomObject]@{
          IdentityReference = $_.IdentityReference.ToString()
          AccessControlType = $_.AccessControlType.ToString()
          FileSystemRights  = $_.FileSystemRights.ToString()
          InheritanceFlags  = $_.InheritanceFlags.ToString()
          PropagationFlags  = $_.PropagationFlags.ToString()
        }
      }}
    } | ConvertTo-Json -Depth 5
  `;


export const getTransferAclSript = (targetPath: string, isDir: boolean, acl: AclObject) => {

    const securityObjectType = isDir
    ? 'System.Security.AccessControl.DirectorySecurity'
    : 'System.Security.AccessControl.FileSecurity';

    const escapedTarget = escapePSString(targetPath);
    const ruleCommands = acl.Access.value
        .filter((entry: any) => !!entry.FileSystemRights)
        .map((entry: any) => {
        const user = escapePSString(entry.IdentityReference);
        const rights = escapePSString(entry.FileSystemRights);
        const accessType = escapePSString(entry.AccessControlType);

        const inheritanceFlags = isDir && entry.InheritanceFlags !== 'None'
            ? 'ContainerInherit, ObjectInherit'
            : 'None';

        const propagationFlags = isDir && entry.PropagationFlags !== 'None'
            ? entry.PropagationFlags
            : 'None';

        return `
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule (
            '${user}',
            [Enum]::Parse([System.Security.AccessControl.FileSystemRights], '${rights}'),
            [Enum]::Parse([System.Security.AccessControl.InheritanceFlags], '${inheritanceFlags}'),
            [Enum]::Parse([System.Security.AccessControl.PropagationFlags], '${propagationFlags}'),
            [System.Security.AccessControl.AccessControlType]::${accessType}
            )
            $fs.AddAccessRule($rule)
        `.trim();
        });

      const finalScript = `
        if (-Not (Test-Path '${escapedTarget}')) {
        Write-Host "❌ Target not found: '${escapedTarget}'"
        exit 1
        }
        $fs = New-Object ${securityObjectType}
        ${ruleCommands.join('\n')}
        Set-Acl -Path '${escapedTarget}' -AclObject $fs
    `;
    return finalScript;
}

export const validateSidMapping = ({actual ,expected, sidMapping, failedMaps,}: ValidateMappingInput): ValidateMappingResult => {

  const output: ValidateMappingResult = {
    failedSid: '',
    sourceAcl: '',
    targetAcl: ''
  }
  const expectedMaping = new Set(expected.Access.value.map(entry => {
    const val = `(${entry.IdentityReference}, ${entry.AccessControlType}, ${entry.FileSystemRights})`
    output.sourceAcl += val + ', ';
    return val;
  }));

  actual.Access.value.forEach(entry => {
    const val = `(${entry.IdentityReference}, ${entry.AccessControlType}, ${entry.FileSystemRights})`
    if(!expectedMaping.has(val)) {
      const sourceId = sidMapping.get(entry.IdentityReference) ?? entry.IdentityReference;
      output.failedSid += `source = ${sourceId}: expected = ${entry.IdentityReference}, `;
    }
    else output.targetAcl += val + ', ';
    }
  );
  
  if(failedMaps.length > 0)  
    output.failedSid += `Mapping Not Found for ${failedMaps.join(', ')}`
  return output;
}