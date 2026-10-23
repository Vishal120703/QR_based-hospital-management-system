import { type BedQrCode } from '@prisma/client';
import { ConflictError } from '../../common/errors/app-error.js';
import { createOpaqueToken, hashOpaqueToken } from '../../common/opaque-token.js';
import { decryptQrToken, encryptQrToken } from '../../common/qr-token-encryption.js';

export type QrCodeView = Omit<BedQrCode, 'tokenHash' | 'tokenCiphertext'> & {
  readonly printable: boolean;
};

export interface QrIssue {
  readonly qrCode: QrCodeView;
  readonly token: string;
  readonly url: string;
}

export interface NewQrToken {
  readonly token: string;
  readonly stored: { readonly tokenHash: string; readonly tokenCiphertext: string };
}

export function toQrCodeView({ tokenHash, tokenCiphertext, ...view }: BedQrCode): QrCodeView {
  void tokenHash;
  return { ...view, printable: tokenCiphertext !== null };
}

// Owns the security-sensitive conversion between a public QR token and the
// hash/encrypted copy kept in the database. Services only orchestrate its use.
export class QrTokenCodec {
  public constructor(
    private readonly publicAppUrl: string,
    private readonly encryptionKey: Buffer,
  ) {}

  public create(): NewQrToken {
    const token = createOpaqueToken();
    return { token, stored: this.toStored(token) };
  }

  public toStored(token: string): NewQrToken['stored'] {
    return {
      tokenHash: hashOpaqueToken(token),
      tokenCiphertext: encryptQrToken(token, this.encryptionKey),
    };
  }

  public toIssue(qrCode: BedQrCode, token: string): QrIssue {
    return {
      qrCode: toQrCodeView(qrCode),
      token,
      url: `${this.publicAppUrl}/q/${token}`,
    };
  }

  public recover(qrCode: BedQrCode): string {
    try {
      if (!qrCode.tokenCiphertext) throw new Error('Missing encrypted QR token.');
      const token = decryptQrToken(qrCode.tokenCiphertext, this.encryptionKey);
      if (hashOpaqueToken(token) !== qrCode.tokenHash) throw new Error('QR token hash mismatch.');
      return token;
    } catch {
      throw new ConflictError(
        'This QR code cannot be safely reprinted. Replace it once to make future reprints available.',
      );
    }
  }
}
