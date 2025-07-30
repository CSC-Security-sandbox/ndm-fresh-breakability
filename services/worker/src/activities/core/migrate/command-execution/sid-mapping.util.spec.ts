import { getAclScript, getTransferAclSript, validateSidMapping } from "./sid-mapping.util";
import { AclObject, ValidateMappingInput } from "./sid-mapping.util.type";


describe('sid-mapping.util', () => {
describe('getAclScript', () => {
    it('should generate PowerShell script with escaped file path', () => {
        const filePath = "C:\\path\\to\\file'sample.txt";
        const script = getAclScript(filePath);
        expect(script).toContain("$path = 'C:\\path\\to\\file''sample.txt'");
        expect(script).toContain('Get-Acl $path');
        expect(script).toContain('ConvertTo-Json -Depth 5');
    });
});

describe('getTransferAclSript', () => {
    const acl: AclObject = {
        Access: {
            value: [
                {
                    IdentityReference: "DOMAIN\\User",
                    AccessControlType: "Allow",
                    FileSystemRights: "Read, Write",
                    InheritanceFlags: "ContainerInherit",
                    PropagationFlags: "None",
                },
                {
                    IdentityReference: "DOMAIN\\OtherUser",
                    AccessControlType: "Deny",
                    FileSystemRights: "FullControl",
                    InheritanceFlags: "None",
                    PropagationFlags: "None",
                },
            ],
        },
    } as any;

    it('should generate script for directory with correct security object', () => {
        const script = getTransferAclSript("C:\\target\\dir", true, acl);
        expect(script).toContain("New-Object System.Security.AccessControl.DirectorySecurity");
        expect(script).toContain("Set-Acl -Path 'C:\\target\\dir' -AclObject $fs");
        expect(script).toContain("[System.Security.AccessControl.AccessControlType]::Allow");
        expect(script).toContain("[System.Security.AccessControl.AccessControlType]::Deny");
        expect(script).toContain("[Enum]::Parse([System.Security.AccessControl.InheritanceFlags], 'ContainerInherit, ObjectInherit')");
    });

    it('should generate script for file with correct security object', () => {
        const script = getTransferAclSript("C:\\target\\file.txt", false, acl);
        expect(script).toContain("New-Object System.Security.AccessControl.FileSecurity");
        expect(script).toContain("Set-Acl -Path 'C:\\target\\file.txt' -AclObject $fs");
        expect(script).toContain("[Enum]::Parse([System.Security.AccessControl.InheritanceFlags], 'None')");
    });

    it('should escape single quotes in target path and user', () => {
        const aclWithQuote: AclObject = {
            Access: {
                value: [
                    {
                        IdentityReference: "DOMAIN\\O'User",
                        AccessControlType: "Allow",
                        FileSystemRights: "Read",
                        InheritanceFlags: "None",
                        PropagationFlags: "None",
                    },
                ],
            },
        }as any;
        const script = getTransferAclSript("C:\\target\\fi'le.txt", false, aclWithQuote);
        expect(script).toContain("C:\\target\\fi''le.txt");
        expect(script).toContain("'DOMAIN\\O''User'");
    });
});

describe('validateSidMapping', () => {
    const sidMapping = new Map<string, string>([
        ["S-1-5-21-User1", "DOMAIN\\User1"],
        ["S-1-5-21-User2", "DOMAIN\\User2"],
    ]);

    it('should return correct output when all entries match', () => {
        const input: ValidateMappingInput = {
            actual: {
                Access: {
                    value: [
                        { IdentityReference: "DOMAIN\\User1", AccessControlType: "Allow", FileSystemRights: "Read" },
                    ],
                },
            },
            expected: {
                Access: {
                    value: [
                        { IdentityReference: "DOMAIN\\User1", AccessControlType: "Allow", FileSystemRights: "Read" },
                    ],
                },
            },
            sidMapping,
            failedMaps: [],
        }as any;
        const result = validateSidMapping(input);
        expect(result.failedSid).toBe('');
        expect(result.sourceAcl).toContain('(DOMAIN\\User1, Allow, Read)');
        expect(result.targetAcl).toContain('(DOMAIN\\User1, Allow, Read)');
    });

    it('should report failedSid when actual entry does not match expected', () => {
        const input: ValidateMappingInput = {
            actual: {
                Access: {
                    value: [
                        { IdentityReference: "DOMAIN\\User2", AccessControlType: "Deny", FileSystemRights: "Write" },
                    ],
                },
            },
            expected: {
                Access: {
                    value: [
                        { IdentityReference: "DOMAIN\\User1", AccessControlType: "Allow", FileSystemRights: "Read" },
                    ],
                },
            },
            sidMapping,
            failedMaps: [],
        }as any;
        const result = validateSidMapping(input);
        expect(result.failedSid).toContain('source = DOMAIN\\User2: expected = DOMAIN\\User2');
        expect(result.sourceAcl).toContain('(DOMAIN\\User1, Allow, Read)');
        expect(result.targetAcl).not.toContain('(DOMAIN\\User2, Deny, Write)');
    });

    it('should append Mapping Not Found for failedMaps', () => {
        const input: ValidateMappingInput = {
            actual: {
                Access: {
                    value: [
                        { IdentityReference: "DOMAIN\\User2", AccessControlType: "Deny", FileSystemRights: "Write" },
                    ],
                },
            },
            expected: {
                Access: {
                    value: [],
                },
            },
            sidMapping,
            failedMaps: ['DOMAIN\\User2'],
        }as any;
        const result = validateSidMapping(input);
        expect(result.failedSid).toContain('Mapping Not Found for DOMAIN\\User2');
    });

    it('should use IdentityReference as sourceId if not in sidMapping', () => {
        const input: ValidateMappingInput = {
            actual: {
                Access: {
                    value: [
                        { IdentityReference: "UNKNOWN\\User", AccessControlType: "Allow", FileSystemRights: "Read" },
                    ],
                },
            },
            expected: {
                Access: {
                    value: [],
                },
            },
            sidMapping,
            failedMaps: [],
        }as any;
        const result = validateSidMapping(input);
        expect(result.failedSid).toContain('source = UNKNOWN\\User: expected = UNKNOWN\\User');
    });
});
});