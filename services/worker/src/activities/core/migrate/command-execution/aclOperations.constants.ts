export const PERMISSION_MAP: Record<string, string> = {
    'F': 'Full Control',
    'M': 'Modify',
    'RX': 'Read & Execute',
    'R': 'Read',
    'W': 'Write',
    'D': 'Delete',
    'DE': 'Delete',
    'RC': 'Read Control',
    'WDAC': 'Write DAC',
    'WO': 'Write Owner',
    'S': 'Synchronize',
    'AS': 'Access System Security',
    'MA': 'Maximum Allowed',
    'GR': 'Generic Read',
    'GW': 'Generic Write',
    'GE': 'Generic Execute',
    'GA': 'Generic All',
    'RD': 'Read Data/List Directory',
    'WD': 'Write Data/Add File',
    'AD': 'Append Data/Add Subdirectory',
    'REA': 'Read Extended Attributes',
    'WEA': 'Write Extended Attributes',
    'X': 'Execute/Traverse',
    'DC': 'Delete Child',
    'RA': 'Read Attributes',
    'WA': 'Write Attributes',
    'OI': 'Object Inherit',
    'CI': 'Container Inherit',
    'IO': 'Inherit Only',
    'NP': 'No Propagate',
    'I': 'Inherited'
};

export const INHERITANCE_FLAGS = ['OI', 'CI', 'IO', 'NP'];
export const NON_SETTABLE_FLAGS = ['I'];
export const SID_REGEX = /^S-\d-\d+-(\d+-){1,14}\d+$/;
export const COMMAND_TIMEOUT = 30000; // 30 seconds
