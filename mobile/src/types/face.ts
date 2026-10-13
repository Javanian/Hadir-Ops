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
}
