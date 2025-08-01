export const PERMISSION_MAP: Record<string, string> = {
    // Full control
    'F': 'Full control',
    
    // Modify
    'M': 'Modify',
    
    // Read & Execute
    'RX': 'Read & Execute',
    
    // Read
    'R': 'Read',
    
    // Write
    'W': 'Write',
    
    // Execute/Traverse
    'X': 'Execute/Traverse',
    
    // Delete
    'D': 'Delete',
    
    // Read permissions
    'RC': 'Read permissions',
    
    // Change permissions
    'WDAC': 'Change permissions',
    
    // Take ownership
    'WO': 'Take ownership',
    
    // Synchronize
    'S': 'Synchronize',
    
    // Read data
    'RD': 'Read data',
    
    // Write data
    'WD': 'Write data',
    
    // Append data
    'AD': 'Append data',
    
    // Read extended attributes
    'REA': 'Read extended attributes',
    
    // Write extended attributes
    'WEA': 'Write extended attributes',
    
    // Delete child
    'DC': 'Delete child',
    
    // Read attributes
    'RA': 'Read attributes',
    
    // Write attributes
    'WA': 'Write attributes',
    
    // Inheritance flags
    'OI': 'Object inherit',
    'CI': 'Container inherit',
    'IO': 'Inherit only',
    'NP': 'No propagate inherit',
    'I': 'Inherited'
};

export const INHERITANCE_FLAGS = ['OI', 'CI', 'IO', 'NP'];
export const NON_SETTABLE_FLAGS = ['I'];
export const SID_REGEX = /^S-\d-\d+-(\d+-){1,14}\d+$/;

// Optimize timeout for production workloads
export const COMMAND_TIMEOUT = process.env.NODE_ENV === 'production' ? 15000 : 30000; // 15s in prod, 30s in dev

// Add batch processing constants for production
export const BATCH_SIZE = 1000; // Process ACLs in batches
export const MAX_RETRIES = 2; // Retry failed operations
export const RETRY_DELAY = 100; // ms between retries
