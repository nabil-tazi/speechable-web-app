/**
 * Utility types for deriving context action interfaces from server actions
 */

// Helper type to extract the success/error wrapper pattern used in contexts
export type ContextActionResult<T> = T extends Promise<{
  data: infer D;
  error: string | null;
}>
  ? Promise<{
      success: boolean;
      data?: D;
      error?: string;
    }>
  : T extends Promise<{ success: boolean; error?: string | null }>
  ? T
  : never;

// Helper type to create context actions from server actions
export type DeriveContextAction<T extends (...args: any[]) => any> = (
  ...args: Parameters<T>
) => ContextActionResult<ReturnType<T>>;

// Utility type to create context actions interface from a record of server actions
export type DeriveContextActions<
  TActions extends Record<string, (...args: any[]) => any>
> = {
  [K in keyof TActions]: DeriveContextAction<TActions[K]>;
};

// Special case for actions that don't follow the standard pattern
export type CustomContextAction<
  TParams extends any[],
  TResult extends any
> = (...args: TParams) => Promise<TResult>;