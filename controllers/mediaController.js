import { deleteOwnedMedia, uploadPostImage } from "../services/mediaService.js";
import { uploadPurposeSchema } from "../schemas/profileSchemas.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { sendSuccess } from "../utils/response.js";

// multer has already parsed the multipart body: the file is in req.file, text fields in req.body
export const upload = async (req, res) => {
    const parsed = uploadPurposeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0].message);
    }
    const media = await uploadPostImage(req.user, req.file, parsed.data.purpose);
    return sendSuccess(res, 201, { media });
};

export const remove = async (req, res) => {
    if (!Number.isInteger(Number(req.params.id))) {
        throw new NotFoundError("Media not found");
    }
    await deleteOwnedMedia(req.user, Number(req.params.id));
    return sendSuccess(res, 200);
};
