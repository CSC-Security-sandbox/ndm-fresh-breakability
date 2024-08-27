// src/schemas/inventory.schema.ts
import { Schema, Document, model } from 'mongoose';

interface Metadata {
  rwxflag: string;
  gid: number;
  uid: number;
  timestamp: Date;
}

export interface Inventory extends Document {
  name: string;
  folder: boolean;
  metadata: Metadata;
}

export const MetadataSchema = new Schema<Metadata>({
  rwxflag: { type: String, required: true },
  gid: { type: Number, required: true },
  uid: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
});

export const InventorySchema = new Schema<Inventory>({
  name: { type: String, required: true },
  folder: { type: Boolean, required: true, default: false },
  metadata: { type: MetadataSchema, required: true },
});

export const InventoryModel = model<Inventory>('Inventory', InventorySchema);
