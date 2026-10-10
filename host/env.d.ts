// Ambient declarations for the host scripts (types only; nothing is emitted).

/** TypeScript utility type the After Effects declarations use; noLib leaves it out. */
type Extract<T, U> = T extends U ? T : never;
type NonNullable<T> = T extends null | undefined ? never : T;

/** The command table, created by the wrapper in scripts/build-host.ts: C.<name>(args) for every bridged tool. */
declare var C: { [command: string]: (a?: any) => any };

/** Array-like values After Effects returns (property values, collections); the ES3 library has no ArrayLike. */
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T }

/** A property or group reached by a path of match names: what it is depends on the path, so call sites cast. */
type PropNode = Property<any> | PropertyGroup | MaskPropertyGroup | Layer;
/** A property value as JSON carries it: number, string, boolean or a number array. */
type Json = number | string | boolean | null | Json[] | { [key: string]: Json };

// Missing from the After Effects 22.0 declarations (types-for-adobe), present in After Effects.
interface Application { /** The After Effects install folder. */ path: Folder }

/** JSON comes from the json.jsx polyfill (ExtendScript has none). */
declare var JSON: { parse(text: string): any; stringify(value: any, replacer?: any, space?: string | number): string };

// What property() returns depends on the match name or index (a property, a group, a mask...), which the declarations
// can't know, so it is "any" here (this overload comes first) and call sites use the result as what the path leads to.
// Layers, comps, items, keys and every helper's parameters stay strictly typed.
interface PropertyBase { property(nameOrIndex: string | number): any }

/** Commands the server calls with other arguments than the tool's, or that are not tools (args.d.ts has the rest). */
interface HostArgs {
  preview_frame: { comp_id: number; time: number; output_path: string };
  prepare_render: { comp_id: number; software?: boolean };
}

// Members the After Effects 22.0 declarations lack: newer APIs (feature-checked before use) and undocumented ones.
interface AVLayer {
  /** After Effects 23.0+. */ setTrackMatte?(trackMatteLayer: AVLayer | null, trackMatteType: TrackMatteType): void;
  /** After Effects 23.0+ (read through safe()). */ readonly trackMatteLayer: AVLayer | null;
}
interface Project { /** The project has unsaved changes. */ dirty: boolean }

// After Effects 24.0+ text and font APIs (feature-checked before use).
declare var FontCapsOption: { FONT_NORMAL_CAPS: number; FONT_SMALL_CAPS: number; FONT_ALL_CAPS: number };
/** Member names differ between versions (text.ts baseEnum looks them up). */
declare var FontBaselineOption: { [name: string]: number };
interface FontObject { familyName: string; styleName: string; postScriptName: string }
interface Application { fonts?: { allFonts: FontObject[][]; getFontsByPostScriptName(name: string): FontObject[] | undefined } }
