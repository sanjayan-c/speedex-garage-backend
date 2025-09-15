// src/middleware/validate.js
export function validate(schema, source = "body") {
    return (req, res, next) => {
      const { error, value } = schema.validate(req[source]);
      if (error) return res.status(400).json({ error: error.message });
      req[source] = value; // put the sanitized value back
      next();
    };
  }
  