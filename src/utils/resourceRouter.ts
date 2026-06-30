import { Router } from "express";
import { isValidObjectId, Model } from "mongoose";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "./asyncHandler";
import { CustomError } from "../errors/customError.error";

type AnyRecord = Record<string, unknown>;

export interface ResourceRouterOptions {
  searchableFields?: string[];
  transformCreate?: (body: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  transformUpdate?: (body: AnyRecord) => Promise<AnyRecord> | AnyRecord;
  sanitize?: (doc: AnyRecord) => AnyRecord;
}

function buildSearch(searchableFields: string[] | undefined, term: string) {
  if (!searchableFields?.length || !term) {
    return {};
  }

  return {
    $or: searchableFields.map((field) => ({
      [field]: { $regex: term, $options: "i" },
    })),
  };
}

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildResourceRouter(model: Model<any>, options: ResourceRouterOptions = {}) {
  const router = Router();

  router.use(authMiddleware);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const page = toNumber(req.query.page, 1);
      const limit = toNumber(req.query.limit, 20);
      const search = String(req.query.search || "").trim();
      const sortBy = String(req.query.sortBy || "createdAt");
      const order = String(req.query.order || "desc").toLowerCase() === "asc" ? 1 : -1;
      const filter = buildSearch(options.searchableFields, search);

      const [total, rawData] = await Promise.all([
        model.countDocuments(filter),
        model
          .find(filter)
          .sort({ [sortBy]: order })
          .skip((page - 1) * limit)
          .limit(limit),
      ]);

      const data = rawData.map((doc) => {
        const normalized = doc.toObject();
        return options.sanitize ? options.sanitize(normalized) : normalized;
      });

      res.json({ data, total, page, limit });
    }),
  );

  router.get(
    "/count",
    asyncHandler(async (_req, res) => {
      const count = await model.countDocuments();
      res.json({ count });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        throw new CustomError("Invalid resource id", 400);
      }

      const doc = await model.findById(id);

      if (!doc) {
        throw new CustomError("Resource not found", 404);
      }

      const normalized = doc.toObject();
      const data = options.sanitize ? options.sanitize(normalized) : normalized;

      res.json({ data });
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const payload = options.transformCreate ? await options.transformCreate(req.body as AnyRecord) : (req.body as AnyRecord);
      const created = await model.create(payload);
      const normalized = created.toObject();
      const data = options.sanitize ? options.sanitize(normalized) : normalized;

      res.status(201).json({ data, message: "Created successfully" });
    }),
  );

  router.put(
    "/:id",
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        throw new CustomError("Invalid resource id", 400);
      }

      const payload = options.transformUpdate ? await options.transformUpdate(req.body as AnyRecord) : (req.body as AnyRecord);
      const updated = await model.findByIdAndUpdate(id, payload, { new: true, runValidators: true });

      if (!updated) {
        throw new CustomError("Resource not found", 404);
      }

      const normalized = updated.toObject();
      const data = options.sanitize ? options.sanitize(normalized) : normalized;

      res.json({ data, message: "Updated successfully" });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        throw new CustomError("Invalid resource id", 400);
      }

      const deleted = await model.findByIdAndDelete(id);

      if (!deleted) {
        throw new CustomError("Resource not found", 404);
      }

      res.json({ message: "Deleted successfully" });
    }),
  );

  return router;
}
