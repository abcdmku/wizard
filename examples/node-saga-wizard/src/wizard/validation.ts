import {
  initSchema,
  reserveSchema,
  chargeSchema,
  notifySchema,
  completeSchema,
} from "./types";

export const validateInit = ({ data }: { data: unknown }) => {
  initSchema.parse(data);
};

export const validateReserve = ({ data }: { data: unknown }) => {
  reserveSchema.parse(data);
};

export const validateCharge = ({ data }: { data: unknown }) => {
  chargeSchema.parse(data);
};

export const validateNotify = ({ data }: { data: unknown }) => {
  notifySchema.parse(data);
};

export const validateComplete = ({ data }: { data: unknown }) => {
  completeSchema.parse(data);
};