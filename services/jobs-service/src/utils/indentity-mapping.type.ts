export type ParsedMapping =
  | { sourceMapping: string; targetMapping: string }
  | {
      sourceMappingGid: string;
      targetMappingGid: string;
      sourceMappingUid: string;
      targetMappingUid: string;
    };
