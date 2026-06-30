import { buildResourceRouter } from "../utils/resourceRouter";
import { UserModel } from "../models/user.model";
import { hashPassword } from "../utils/password";

export default buildResourceRouter(UserModel, {
  searchableFields: ["name", "lastname", "email", "ci", "phone"],
  transformCreate: async (body) => ({
    ...body,
    email: typeof body.email === "string" ? body.email.toLowerCase() : body.email,
    password: body.password ? await hashPassword(String(body.password)) : undefined,
  }),
  transformUpdate: async (body) => {
    const nextBody = { ...body };

    if (typeof nextBody.email === "string") {
      nextBody.email = nextBody.email.toLowerCase();
    }

    if (typeof nextBody.password === "string" && nextBody.password.length > 0) {
      nextBody.password = await hashPassword(nextBody.password);
    } else {
      delete nextBody.password;
    }

    return nextBody;
  },
  sanitize: (doc) => {
    const { password, tokenVersion, ...safe } = doc;
    return safe;
  },
});
