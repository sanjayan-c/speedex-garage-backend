import { google } from "googleapis";
import path from "path";
import stream from "stream";
import multer from "multer";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();


// __dirname equivalent in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEYFILEPATH = process.env.GOOGLE_KEYFILE_PATH;

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth });

const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;

const storage = multer.memoryStorage();
export const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max file size for video/audio files
});

export async function uploadToDrive(fileBuffer, fileName, mimeType) {
  try {
    console.log('Starting upload to Drive for file:', fileName);
    const bufferStream = new stream.PassThrough();
    bufferStream.end(fileBuffer);

    const { data } = await drive.files.create({
      media: {
        mimeType,
        body: bufferStream,
      },
      requestBody: {
        name: fileName,
        parents: [folderId],
        driveId: sharedDriveId,
      },
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "id",
    });

    console.log('File uploaded successfully to Drive, ID:', data.id);
    return data.id;
  } catch (error) {
    console.error('Error uploading to Google Drive:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      errors: error.errors
    });
    throw new Error(`Failed to upload file to Google Drive: ${error.message}`);
  }
}
