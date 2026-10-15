const path = require('path');
const fs = require('fs');
const cloudinary = require('../config/cloudinary');
const env = require('../config/env');
const logger = require('../utils/logger');

// Check if Cloudinary is fully configured
const isCloudinaryConfigured = () => {
  return Boolean(
    env.cloudinary.cloudName &&
    env.cloudinary.apiKey &&
    env.cloudinary.apiSecret
  );
};

// Determine appropriate Cloudinary resource_type based on MIME type and filename
const getResourceType = (mimetype, filename) => {
  if (mimetype && mimetype.startsWith('image/')) {
    // Note: svg can be uploaded as image in Cloudinary
    return 'image';
  }
  const ext = (path.extname(filename || '') || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff'].includes(ext)) {
    return 'image';
  }
  // All other documents (pdf, docx, pptx, txt, zip, etc.) must be stored as 'raw'
  return 'raw';
};

/**
 * Upload a file buffer to Cloudinary (or local disk in development fallback)
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - { folder, originalname, mimetype }
 * @returns {Promise<{ url: string, publicId: string, resourceType: string }>}
 */
const uploadBuffer = async (buffer, { folder = 'Classence', originalname = 'file', mimetype = '' } = {}) => {
  const hasCloudinary = isCloudinaryConfigured();

  // In production, missing Cloudinary configuration must fail fast and safely
  if (env.isProduction && !hasCloudinary) {
    logger.error('CRITICAL: Cloud storage upload attempted in production, but Cloudinary is not configured.');
    throw new Error('Cloud storage service is not configured.');
  }

  // If Cloudinary is configured (production or configured development), upload via stream
  if (hasCloudinary) {
    const resourceType = getResourceType(mimetype, originalname);
    const sanitizedName = path.parse(originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = path.extname(originalname);
    
    // For raw files, Cloudinary requires the extension in public_id to preserve it on download
    const publicId = resourceType === 'raw' 
      ? `${sanitizedName}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
      : `${sanitizedName}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
          overwrite: false
        },
        (error, result) => {
          if (error) {
            logger.error('Cloudinary stream upload error:', error.message);
            return reject(new Error(`Failed to upload file to cloud storage: ${error.message}`));
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            resourceType: result.resource_type || resourceType
          });
        }
      );

      uploadStream.end(buffer);
    });
  }

  // Local development fallback when Cloudinary is not configured
  const uploadsDir = path.resolve(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const ext = path.extname(originalname) || '';
  const safeFilename = `${folder.replace(/[/\\?%*:|"<>]/g, '_')}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const filePath = path.join(uploadsDir, safeFilename);

  await fs.promises.writeFile(filePath, buffer);
  const localUrl = `${env.backendUrl}/uploads/${safeFilename}`;

  return {
    url: localUrl,
    publicId: safeFilename,
    resourceType: 'local'
  };
};

/**
 * Delete an asset from Cloudinary (or local disk in development fallback)
 * @param {string} publicId - Cloudinary public_id or local filename
 * @param {string} resourceType - 'image', 'raw', or 'local'
 */
const deleteAsset = async (publicId, resourceType = 'image') => {
  if (!publicId) return;

  try {
    if (isCloudinaryConfigured() && resourceType !== 'local') {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      logger.info(`Cloudinary asset destroyed: ${publicId} (${resourceType}) - result: ${result?.result}`);
      return result;
    }

    if (resourceType === 'local' || !isCloudinaryConfigured()) {
      const localPath = path.resolve(__dirname, '../uploads', path.basename(publicId));
      if (fs.existsSync(localPath)) {
        await fs.promises.unlink(localPath);
        logger.info(`Local asset deleted: ${localPath}`);
      }
    }
  } catch (err) {
    // Log safely without leaking credentials or interrupting DB operations
    logger.warn(`Could not delete storage asset (${publicId}): ${err.message}`);
  }
};

/**
 * Clean up an array of file metadata records
 * @param {Array<{ publicId: string, resourceType: string }>} filesMetadata
 */
const deleteAssets = async (filesMetadata = []) => {
  if (!Array.isArray(filesMetadata) || filesMetadata.length === 0) return;
  for (const item of filesMetadata) {
    if (item && item.publicId) {
      await deleteAsset(item.publicId, item.resourceType);
    }
  }
};

module.exports = {
  isCloudinaryConfigured,
  getResourceType,
  uploadBuffer,
  deleteAsset,
  deleteAssets
};
