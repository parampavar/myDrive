import mongoose from "../../../db/connections/mongoose";
import crypto from "crypto";
import Thumbnail from "../../../models/thumbnail";
import sharp from "sharp";
import { FileInterface } from "../../../models/file";
import { UserInterface } from "../../../models/user";
import fs from "fs";
import uuid from "uuid";
import env from "../../../enviroment/env";
import { ObjectId } from "mongodb";
import File from "../../../models/file";
import ffmpeg from "fluent-ffmpeg";
import tempCreateVideoThumbnailFS from "./tempCreateVideoThumbnailFS";

const createVideoThumbnailFS = (
  file: FileInterface,
  filename: string,
  user: UserInterface
) => {
  return new Promise<FileInterface>(async (resolve, reject) => {
    const password = user.getEncryptionKey();

    let CIPHER_KEY = crypto.createHash("sha256").update(password!).digest();

    const thumbnailFilename = uuid.v4();

    const readStream = fs.createReadStream(file.metadata.filePath!);
    console.log("env", env);
    const writeStream = fs.createWriteStream(
      env.fsDirectory + thumbnailFilename
    );
    const decipher = crypto.createDecipheriv(
      "aes256",
      CIPHER_KEY,
      file.metadata.IV
    );

    const thumbnailIV = crypto.randomBytes(16);

    const thumbnailCipher = crypto.createCipheriv(
      "aes256",
      CIPHER_KEY,
      thumbnailIV
    );

    const decryptedReadStream = readStream.pipe(decipher);

    ffmpeg(decryptedReadStream, {
      timeout: 60,
    })
      .seek(1)
      .format("image2pipe")
      .outputOptions([
        "-f image2pipe",
        "-vframes 1",
        "-vf scale='if(gt(iw,ih),600,-1):if(gt(ih,iw),300,-1)'",
      ])
      .on("start", (command) => {
        /**
         * log
         */
      })
      .on("end", async () => {
        console.log("end");
        const thumbnailModel = new Thumbnail({
          name: filename,
          owner: user._id,
          IV: thumbnailIV,
          path: env.fsDirectory + thumbnailFilename,
        });

        await thumbnailModel.save();
        if (!file._id) {
          return reject();
        }
        const updateFileResponse = await File.updateOne(
          { _id: new ObjectId(file._id), "metadata.owner": user._id },
          {
            $set: {
              "metadata.hasThumbnail": true,
              "metadata.thumbnailID": thumbnailModel._id,
            },
          }
        );
        if (updateFileResponse.modifiedCount === 0) {
          return reject();
        }

        const updatedFile = await File.findById({
          _id: new ObjectId(file._id),
          "metadata.owner": user._id,
        });

        if (!updatedFile) return reject();

        resolve(updatedFile?.toObject());
      })
      .on("error", async (err, _, stderr) => {
        console.log("thumbnail error attempting temp directory fix");
        const updatedFile = await tempCreateVideoThumbnailFS(
          file,
          filename,
          user
        );
        resolve(updatedFile);
        /**
         * log
         */
      })
      .pipe(thumbnailCipher)
      .pipe(writeStream, { end: true });
  });
};

export default createVideoThumbnailFS;
