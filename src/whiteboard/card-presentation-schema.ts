import {z} from 'zod';
export const CardPresentationSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('formula'),latex:z.string().min(1).max(16000),explanation:z.string().max(4000),symbols:z.array(z.object({latex:z.string().min(1).max(500),meaning:z.string().min(1).max(1200)}).strict()).max(40)}).strict(),
 z.object({type:z.literal('evidence'),statement:z.string().min(1).max(6000),explanation:z.string().max(4000)}).strict()
]);
export type CardPresentation=z.infer<typeof CardPresentationSchema>;
