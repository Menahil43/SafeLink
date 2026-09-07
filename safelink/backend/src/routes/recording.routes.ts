import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyFirebaseToken, AuthRequest } from '../middleware/auth.middleware';
import Recording from '../models/Recording.model';
import Emergency from '../models/Emergency.model';
import { generateUploadUrl, generateDownloadUrl, uploadObject, buildRecordingChunkKey } from '../services/oss.service';
import Joi from 'joi';
import multer from 'multer';
import { logger } from '../utils/logger';

const router = Router();
router.use(verifyFirebaseToken);
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ['audio/mp4', 'audio/m4a', 'audio/aac', 'audio/3gpp'].includes(file.mimetype));
  },
});
const parseAudioUpload = (req: any, res: any, next: any) => {
  audioUpload.single('audio')(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.message });
    }
    return res.status(400).json({ error: 'Invalid audio upload' });
  });
};

// POST /api/emergencies/:emergencyId/recordings/session — OSS session
router.post('/emergencies/:emergencyId/recordings/session', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await Emergency.findOne({ _id: req.params.emergencyId, userId: req.user!._id });
  if (!emergency) return res.status(404).json({ error: 'Emergency not found' });
  const recording = await Recording.create({
    emergencyId: emergency._id,
    userId: req.user!._id,
    fileType: 'audio/mp4',
    storageProvider: 'alibaba-oss',
    uploadStatus: 'recording',
    chunks: [],
    startedAt: new Date(),
  });
  await Emergency.findByIdAndUpdate(emergency._id, { recordingId: recording._id });
  logger.info('Recording session created', { recordingId: recording._id.toString(), emergencyId: emergency._id.toString() });
  return res.status(201).json({ recording: { id: recording._id, emergencyId: emergency._id, uploadStatus: recording.uploadStatus } });
}));

// POST /api/emergencies/:emergencyId/recordings — accept one real audio segment.
router.post('/emergencies/:emergencyId/recordings', parseAudioUpload, asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await Emergency.findOne({ _id: req.params.emergencyId, userId: req.user!._id });
  if (!emergency) return res.status(404).json({ error: 'Emergency not found' });
  if (!req.file) return res.status(400).json({ error: 'Audio file is required in the audio form field' });
  logger.info('Emergency ownership verified for recording upload', { emergencyId: emergency._id.toString() });

  const schema = Joi.object({
    recordingId: Joi.string(),
    chunkIndex: Joi.number().integer().min(0).default(0),
    durationSeconds: Joi.number().min(0.01).max(60).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  logger.info('Recording upload received', {
    emergencyId: emergency._id.toString(),
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    sizeBytes: req.file.size,
  });

  const recording = value.recordingId
    ? await Recording.findOne({ _id: value.recordingId, emergencyId: emergency._id, userId: req.user!._id })
    : await Recording.create({
        emergencyId: emergency._id,
        userId: req.user!._id,
        fileType: req.file.mimetype,
        uploadStatus: 'uploading',
        chunks: [],
        startedAt: new Date(),
      });
  if (!recording) return res.status(404).json({ error: 'Recording session not found' });

  if (!value.recordingId) await Emergency.findByIdAndUpdate(emergency._id, { recordingId: recording._id });
  const storagePath = `recordings/${req.user!._id}/${emergency._id}/${recording._id}/segment_${String(value.chunkIndex).padStart(8, '0')}.m4a`;
  logger.info('Alibaba OSS upload started', { recordingId: recording._id.toString(), storagePath });
  await uploadObject(storagePath, req.file.buffer, req.file.mimetype);
  const cloudUrl = await generateDownloadUrl(storagePath, 900);
  logger.info('Alibaba OSS upload completed', { recordingId: recording._id.toString(), storagePath });

  if (!recording.chunks.some((chunk) => chunk.index === value.chunkIndex)) {
    recording.chunks.push({ index: value.chunkIndex, ossKey: storagePath, sizeBytes: req.file.size, durationSeconds: value.durationSeconds, uploadedAt: new Date() });
  }
  recording.uploadStatus = 'uploaded';
  recording.lastUploadedAt = new Date();
  recording.sizeBytes = recording.chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
  recording.durationSeconds = recording.chunks.reduce((total, chunk) => total + chunk.durationSeconds, 0);
  recording.ossKey = storagePath;
  recording.storageProvider = 'alibaba-oss';
  await recording.save();
  logger.info('MongoDB recording record saved', { recordingId: recording._id.toString(), emergencyId: emergency._id.toString() });

  return res.status(201).json({
    recording: { id: recording._id, emergencyId: emergency._id, storagePath, cloudUrl, uploadStatus: recording.uploadStatus, chunkIndex: value.chunkIndex },
  });
}));

// POST /api/recordings/:id/chunks — issue a short-lived URL for one real segment
router.post('/:id/chunks', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    index: Joi.number().integer().min(0).required(),
    contentType: Joi.string().valid('audio/mp4', 'audio/m4a').default('audio/m4a'),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const recording = await Recording.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  const ossKey = buildRecordingChunkKey(recording.id, value.index);
  const uploadUrl = await generateUploadUrl(ossKey, value.contentType, 900);
  return res.json({ uploadUrl, ossKey, expiresInSeconds: 900 });
}));

// POST /api/recordings/:id/chunks/:index/confirm — persist only after client PUT succeeds
router.post('/:id/chunks/:index/confirm', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    sizeBytes: Joi.number().integer().min(1).max(20 * 1024 * 1024).required(),
    durationSeconds: Joi.number().min(0.01).max(60).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  const recording = await Recording.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  const index = Number(req.params.index);
  const existing = recording.chunks.find((chunk) => chunk.index === index);
  if (!existing) {
    recording.chunks.push({ index, ossKey: buildRecordingChunkKey(recording.id, index), ...value, uploadedAt: new Date() });
  }
  recording.uploadStatus = 'uploading';
  recording.lastUploadedAt = new Date();
  recording.sizeBytes = recording.chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
  recording.durationSeconds = recording.chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0);
  await recording.save();
  return res.json({ recording: { id: recording.id, uploadStatus: recording.uploadStatus, uploadedChunks: recording.chunks.length } });
}));

// POST /api/recordings/:id/finalize — mark the complete set of uploaded segments
router.post('/:id/finalize', asyncHandler(async (req: AuthRequest, res) => {
  const recording = await Recording.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id },
    { $set: { uploadStatus: 'completed', endedAt: new Date() } },
    { new: true }
  );
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  return res.json({ recording: { id: recording.id, uploadStatus: recording.uploadStatus, uploadedChunks: recording.chunks.length } });
}));

// GET /api/emergencies/:emergencyId/recordings
router.get('/emergencies/:emergencyId/recordings', asyncHandler(async (req: AuthRequest, res) => {
  const emergency = await Emergency.findOne({
    _id: req.params.emergencyId,
    userId: req.user!._id,
  });
  if (!emergency) return res.status(404).json({ error: 'Emergency not found' });

  const recordings = await Recording.find({ emergencyId: emergency._id });

  const recordingsWithUrls = await Promise.all(
    recordings.map(async (rec) => ({
      id: rec._id,
      uploadStatus: rec.uploadStatus,
      durationSeconds: rec.durationSeconds,
      sizeBytes: rec.sizeBytes,
      startedAt: rec.startedAt,
      endedAt: rec.endedAt,
      chunks: await Promise.all(rec.chunks.map(async (chunk) => ({
        index: chunk.index,
        sizeBytes: chunk.sizeBytes,
        durationSeconds: chunk.durationSeconds,
        uploadedAt: chunk.uploadedAt,
        downloadUrl: await generateDownloadUrl(chunk.ossKey, 900),
      }))),
      downloadUrl: null,
    }))
  );

  return res.json({ recordings: recordingsWithUrls });
}));

// PUT /api/recordings/:id  — Update recording metadata after upload completes
router.put('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const schema = Joi.object({
    uploadStatus: Joi.string().valid('uploading', 'uploaded', 'failed', 'retrying', 'completed'),
    durationSeconds: Joi.number().min(0),
    sizeBytes: Joi.number().min(0),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const recording = await Recording.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!._id },
    {
      $set: value,
      $inc: { uploadAttempts: value.uploadStatus === 'uploading' ? 1 : 0 },
      ...(value.uploadStatus === 'uploaded' ? { $set: { endedAt: new Date() } } : {}),
    },
    { new: true }
  );

  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  return res.json({ recording: { id: recording._id, uploadStatus: recording.uploadStatus } });
}));

// POST /api/recordings/:id/retry-upload  — Get a fresh upload URL for retry
router.post('/:id/retry-upload', asyncHandler(async (req: AuthRequest, res) => {
  const recording = await Recording.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!recording) return res.status(404).json({ error: 'Recording not found' });
  if (!recording.ossKey) return res.status(400).json({ error: 'No OSS key on this recording' });

  await Recording.findByIdAndUpdate(recording._id, {
    uploadStatus: 'retrying',
    $inc: { uploadAttempts: 1 },
  });

  const uploadUrl = await generateUploadUrl(recording.ossKey, recording.fileType, 3600);
  return res.json({ uploadUrl, ossKey: recording.ossKey });
}));

export default router;
