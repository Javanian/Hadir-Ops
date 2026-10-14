export interface FaceStatus {
  user_id: number;
  name: string;
  has_face: boolean;
}

export interface FaceRegisterResponse {
  message: string;
  embedding_dim: number;
}

export interface FaceVerifyResponse {
  verified: boolean;
  similarity: number;
  threshold: number;
  /** Present when the user verified their own face; sent with the check-in as proof. */
  face_token?: string;
}
