import Joi from "joi";
const timeString = Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/);

const registerSchema = Joi.object({
  username: Joi.string().min(3).max(64).required(),
  password: Joi.string().min(8).max(128).required(),
  role: Joi.string().valid("admin", "staff", "user").default("user"),
  isLogin: Joi.boolean().default(false),
  untime: Joi.object({
    startTime: Joi.date().optional(),
    active: Joi.boolean().default(false),
    durationMinutes: Joi.number().integer().min(0).default(0),
  }).optional(),
  createdBy: Joi.string().uuid().optional(),
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

const roleUpdateSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  role: Joi.string().valid("admin", "staff", "user").required(),
});

const passwordUpdateSchema = Joi.object({
  currentPassword: Joi.string().optional(),
  newPassword: Joi.string().min(8).max(128).required(),
});

const staffCreateSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  firstName: Joi.string().max(100).required(),
  lastName: Joi.string().max(100).required(),
  email: Joi.string().email().required(),
  contactNo: Joi.string().max(30).required(),
  emergencyContactNo: Joi.string().max(30).required(),
  shiftStart: timeString.required(),
  shiftEnd:   timeString.required(),
});

const staffUpdateSchema = Joi.object({
  firstName: Joi.string().max(100).optional(),
  lastName: Joi.string().max(100).optional(),
  email: Joi.string().email().optional(),
  contactNo: Joi.string().max(30).optional(),
  emergencyContactNo: Joi.string().max(30).optional(),
  shiftStart: timeString.optional(),
  shiftEnd:   timeString.optional(),
}).min(1);

const shiftUpdateSchema = Joi.object({
  start: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(),
  end:   Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required()
});

export {
  registerSchema,
  loginSchema,
  roleUpdateSchema,
  passwordUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
  shiftUpdateSchema,
};
