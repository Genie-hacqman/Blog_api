import  *  as z from "zod";

// validation schema for creating a new user
export const createUserSchema = z.object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    username: z.string().trim().min(1),
    email: z.email().trim().required,
    password: z.string().min(8).required,
});

// validation schema for login
export const loginUserSchema = z.object({
    email: z.email().trim(),
    password: z.string().trim().min(8),
}); 

