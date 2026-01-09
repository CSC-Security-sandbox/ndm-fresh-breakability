import { ConfigObject, registerAs } from '@nestjs/config';

export default registerAs(
  'temporal',
  (): ConfigObject => {
    const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
    const tlsEnabled = process.env.TEMPORAL_TLS_ENABLED === 'true';
    
    const config: any = { address };
    
    if (tlsEnabled) {
      // Get CA certificate from environment variable (base64 encoded)
      const caCertBase64 = process.env.TEMPORAL_TLS_CA_CERT;
      
      if (caCertBase64) {
        const decoded = Buffer.from(caCertBase64, 'base64');
        console.log(`[Temporal Config] Certificate loaded: ${decoded.length} bytes`);
        console.log(`[Temporal Config] Certificate starts with: ${decoded.toString('utf8').substring(0, 50)}`);
      } else {
        console.log('[Temporal Config] No CA certificate found in environment');
      }
      
      config.tls = {
        serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME,
        // Decode the CA certificate and provide it to SDK
        serverRootCACertificate: caCertBase64 
          ? Buffer.from(caCertBase64, 'base64')
          : undefined,
      };
    }
    
    return config;
  },
);