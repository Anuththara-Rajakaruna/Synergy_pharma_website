import { Types } from "mongoose";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Strict 24-hex check. Types.ObjectId.isValid also accepts any 12-character string, which would
// let arbitrary route parameters reach the database as ids.
export function isObjectIdString(value: string): boolean {
  return typeof value === "string" && OBJECT_ID.test(value);
}

// Callers must validate with isObjectIdString first.
export function toObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}
