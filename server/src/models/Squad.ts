import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { SQUAD_SIZE } from './constants.js';

const squadSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    selectedIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      validate: { validator: (v: unknown[]) => v.length === SQUAD_SIZE, message: `Pick exactly ${SQUAD_SIZE} players` },
    },
    benchedId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmed: { type: Boolean, default: false },
    substitutions: {
      type: [
        new Schema(
          { outId: Schema.Types.ObjectId, inId: Schema.Types.ObjectId, at: Date },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export type SquadAttrs = InferSchemaType<typeof squadSchema>;
export type SquadDoc = HydratedDocument<SquadAttrs>;
export const Squad = model('Squad', squadSchema);
