import { ValidationError } from "../utils/AppError.js";

export const validate = (schema) => (req, res, next) => {

        const result = schema.safeParse(req.body);

        if (!result.success) {
            const issues = result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
            return next(new ValidationError(issues[0].message, { issues }));
        }

        req.body = result.data;

        next();
};
