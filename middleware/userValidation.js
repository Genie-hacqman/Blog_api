export const validate = (schema) => (req, res, next) => {

        const result = schema.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issue[0].message});
        }


        req.body = result.data;
        
        next();
};