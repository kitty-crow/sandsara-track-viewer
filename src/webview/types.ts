export interface FlatTrackPayload {
  readonly points: readonly number[];
  readonly pointCount: number;
  readonly byteLength?: number;
  readonly minX?: number;
  readonly maxX?: number;
  readonly minY?: number;
  readonly maxY?: number;
  readonly maximumRadius?: number;
  readonly warnings?: readonly string[];
  readonly filename?: string;
}

export type TrackEditorState =
  | "empty"
  | "loading"
  | "saved"
  | "dirty"
  | "invalid"
  | "saving";

export type TrackPreviewHostMessage =
  | {
      readonly type: "track";
      readonly payload: FlatTrackPayload;
      readonly resetOriginal: boolean;
    }
  | {
      readonly type: "state";
      readonly state: TrackEditorState;
      readonly message: string;
    };

export type TrackPreviewWebviewMessage =
  | { readonly type: "ready" }
  | { readonly type: "openTrack" }
  | {
      readonly type: "editTrack";
      readonly points: readonly number[];
      readonly source: string;
    }
  | {
      readonly type: "saveTrack";
      readonly points: readonly number[];
      readonly source: string;
      readonly suggestedName: string;
    }
  | { readonly type: "resetTrack" }
  | { readonly type: "showError"; readonly message: string };

export type ImageVectoriserHostMessage = {
  readonly type: "initialiseImage";
  readonly dataUri: string;
  readonly filename: string;
};

export type ImageVectoriserWebviewMessage =
  | { readonly type: "ready" }
  | {
      readonly type: "saveSvg";
      readonly svg: string;
      readonly suggestedName: string;
    }
  | { readonly type: "showError"; readonly message: string };

export type SvgToTrackHostMessage = {
  readonly type: "initialiseSvg";
  readonly svg: string;
  readonly filename: string;
};

export type SvgToTrackWebviewMessage =
  | { readonly type: "ready" }
  | {
      readonly type: "saveTrack";
      readonly points: readonly number[];
      readonly suggestedName: string;
    }
  | { readonly type: "showError"; readonly message: string };
