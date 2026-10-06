import { becomeAuthor as becomeAuthorService } from "../services/userService.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

// Express 5 forwards rejected promises to the error handler, so controllers need no try/catch.
// Register / login / logout live in authController.js.

// controller for the self-service "start writing" upgrade
export const becomeAuthor = async (req, res) => {
    const user = await becomeAuthorService(req.user.id, requestContext(req));
    return sendSuccess(res, 200, { user });
};
