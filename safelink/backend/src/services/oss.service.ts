import OSS from 'ali-oss';
import { logger } from '../utils/logger';

let ossClient: OSS | null = null;

const getOSSClient = (): OSS => {
  if (!ossClient) {
    ossClient = new OSS({
      region: process.env.ALI_OSS_REGION || 'oss-ap-southeast-1',
      accessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET || '',
      bucket: process.env.ALI_OSS_BUCKET || 'safelink-recordings',
      endpoint: process.env.ALI_OSS_ENDPOINT,
      secure: true,
    });
  }
  return ossClient;
};

// Generate a pre-signed upload URL (mobile uploads directly to OSS)
export const generateUploadUrl = async (
  ossKey: string,
  contentType: string = 'audio/m4a',
  expiresInSeconds: number = 3600
): Promise<string> => {
  try {
    const client = getOSSClient();
    const url = client.signatureUrl(ossKey, {
      method: 'PUT',
      expires: expiresInSeconds,
      'Content-Type': contentType,
    });
    return url;
  } catch (error) {
    logger.error('OSS generateUploadUrl error:', error);
    throw error;
  }
};

// Generate a pre-signed download URL (for authorized access)
export const generateDownloadUrl = async (
  ossKey: string,
  expiresInSeconds: number = 900 // 15 minutes
): Promise<string> => {
  try {
    const client = getOSSClient();
    const url = client.signatureUrl(ossKey, { expires: expiresInSeconds });
    return url;
  } catch (error) {
    logger.error('OSS generateDownloadUrl error:', error);
    throw error;
  }
};

export const uploadObject = async (
  ossKey: string,
  content: Buffer,
  contentType: string
): Promise<void> => {
  try {
    await getOSSClient().put(ossKey, content, {
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    logger.error('OSS uploadObject error:', error);
    throw error;
  }
};

// Delete a recording from OSS
export const deleteOSSObject = async (ossKey: string): Promise<void> => {
  try {
    const client = getOSSClient();
    await client.delete(ossKey);
    logger.info(`OSS object deleted: ${ossKey}`);
  } catch (error) {
    logger.error('OSS deleteOSSObject error:', error);
    throw error;
  }
};

// Build the OSS key for a recording
export const buildRecordingKey = (userId: string, emergencyId: string, filename: string): string => {
  return `recordings/${userId}/${emergencyId}/${filename}`;
};

export const buildRecordingChunkKey = (recordingId: string, index: number): string =>
  `recording-chunks/${recordingId}/${index.toString().padStart(8, '0')}.m4a`;
