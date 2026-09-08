import { findUserById, findUserByUsername, findUserByEmail,createUser } from "../repositories/userRepository.js";
import { createUserSchema, loginUserSchema } from "../schemas/userSchemas.js";
import bcrypt from "bcryptjs";


// sanitize new user data
const sanitizeUser = (user) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    email: user.email,
    createAt: user.createdAt,
});

// register a new user
export const registerUser = async ({firstName, lastName, username, email, password}) =>  {

// check if user with the same email or username already exists
    const isEmailTaken = await findUserByEmail(email);
    const isUsernameTaken = await findUserByUsername(username);
    if (isEmailTaken) {
        throw new Error("Email is already taken");
    }
    if (isUsernameTaken) {
        throw new Error("Username is already taken");
    }

const SALT_ROUNDS = 10;

// hash the password 
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    password = hashedPassword;


// create a new user
    const newUser = await createUser({firstName, lastName, username, email, password:hashedPassword});
    return sanitizeUser(newUser);
};

