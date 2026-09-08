import  *  as z from "zod";

// validation schema for creating a new user
export const createUserSchema = z.object({
    firstName: z.string().trim().min(1).required("First name is required"),
    lastName: z.string().trim().min(1).required("Last name is required"),
    username: z.string().trim().min(1).required("Username is required"),
    email: z.email().trim().required("Email is required"),
    password: z.string().min(8).required("Password is required"),
});

// validation schema for login
export const loginUserSchema = z.object({
    email: z.email().trim().required("Email is required"),
    password: z.string().trim().min(8).required("Password is required"),
}); 

