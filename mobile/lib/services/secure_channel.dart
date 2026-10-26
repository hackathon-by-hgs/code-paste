import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

/// A mutually authenticated, encrypted channel to one LAN peer.
///
/// Wire-compatible with the desktop agent's `internal/transport`. The protocol
/// is a station-to-station handshake followed by length-prefixed AES-256-GCM
/// frames:
///
/// ```text
/// dialer   -> version(1) || dialerEph(32)   || dialerStatic(32)
/// listener -> version(1) || listenerEph(32) || listenerStatic(32) || sig(64)
/// dialer   -> sig(64)
/// ```
///
/// Each side signs a transcript containing *both* ephemeral keys, which is what
/// binds authentication to this connection: a signature captured elsewhere
/// covers different ephemeral keys and will not verify. Confidentiality comes
/// from the ephemeral X25519 exchange, so recovering a device's long-term key
/// later does not decrypt traffic captured today.
///
/// What this class establishes is *who* is on the other end — it returns the
/// peer's verified static key. Whether that identity is **authorized** is a
/// separate decision the caller makes against the signed roster. Discovery,
/// authorization and cryptographic proof are three different things, and all
/// three are required.
class SecureChannel {
  static const int handshakeVersion = 1;

  /// Domain separation, byte-identical to the desktop agent.
  static const String transcriptLabel = 'codepaste-handshake-v1';
  static const String keyLabel = 'codepaste-frame-keys-v1';

  static const int x25519KeyLength = 32;
  static const int ed25519KeyLength = 32;
  static const int ed25519SignatureLength = 64;
  static const int nonceLength = 12;
  static const int gcmTagLength = 16;

  /// Bounds what a peer can make us allocate: the largest payload the contract
  /// permits plus room for the envelope.
  static const int maxFrameSize = 11 << 20;

  static final Ed25519 _ed25519 = Ed25519();
  static final X25519 _x25519 = X25519();
  static final AesGcm _aesGcm = AesGcm.with256bits();
  static final Hmac _hmacSha256 = Hmac.sha256();

  final _ByteReader _reader;
  final void Function(List<int> bytes) _write;
  final Future<void> Function() _flush;

  /// The peer's long-term Ed25519 public key, proven by the handshake.
  final Uint8List peerStaticPublicKey;

  final SecretKey _sendKey;
  final SecretKey _recvKey;

  int _sendSequence = 0;
  int _recvSequence = 0;
  bool _closed = false;

  SecureChannel._({
    required _ByteReader reader,
    required void Function(List<int>) write,
    required Future<void> Function() flush,
    required this.peerStaticPublicKey,
    required SecretKey sendKey,
    required SecretKey recvKey,
  }) : _reader = reader,
       _write = write,
       _flush = flush,
       _sendKey = sendKey,
       _recvKey = recvKey;

  /// Runs the initiating side of the handshake.
  static Future<SecureChannel> dial({
    required Stream<Uint8List> incoming,
    required void Function(List<int>) write,
    required Future<void> Function() flush,
    required SimpleKeyPair staticKeyPair,
  }) async {
    return _handshake(
      incoming: incoming,
      write: write,
      flush: flush,
      staticKeyPair: staticKeyPair,
      isDialer: true,
    );
  }

  /// Runs the accepting side of the handshake.
  static Future<SecureChannel> accept({
    required Stream<Uint8List> incoming,
    required void Function(List<int>) write,
    required Future<void> Function() flush,
    required SimpleKeyPair staticKeyPair,
  }) async {
    return _handshake(
      incoming: incoming,
      write: write,
      flush: flush,
      staticKeyPair: staticKeyPair,
      isDialer: false,
    );
  }

  static Future<SecureChannel> _handshake({
    required Stream<Uint8List> incoming,
    required void Function(List<int>) write,
    required Future<void> Function() flush,
    required SimpleKeyPair staticKeyPair,
    required bool isDialer,
  }) async {
    final reader = _ByteReader(incoming);
    try {
      final staticPublic = await staticKeyPair.extractPublicKey();
      final staticPublicBytes = Uint8List.fromList(staticPublic.bytes);
      if (staticPublicBytes.length != ed25519KeyLength) {
        throw const HandshakeException('local static key is not Ed25519');
      }

      final ephemeral = await _x25519.newKeyPair();
      final ephemeralPublic = await ephemeral.extractPublicKey();
      final ephemeralBytes = Uint8List.fromList(ephemeralPublic.bytes);

      Uint8List peerEphemeral;
      Uint8List peerStatic;
      Uint8List transcriptBytes;

      if (isDialer) {
        write(<int>[handshakeVersion]);
        write(ephemeralBytes);
        write(staticPublicBytes);
        await flush();

        await _expectVersion(reader);
        peerEphemeral = await reader.readExactly(x25519KeyLength);
        peerStatic = await reader.readExactly(ed25519KeyLength);
        final peerSignature = await reader.readExactly(ed25519SignatureLength);

        transcriptBytes = _transcript(
          dialerEphemeral: ephemeralBytes,
          dialerStatic: staticPublicBytes,
          listenerEphemeral: peerEphemeral,
          listenerStatic: peerStatic,
        );

        await _requireSignature(
          transcriptBytes: transcriptBytes,
          signature: peerSignature,
          peerStatic: peerStatic,
        );

        final ourSignature = await _ed25519.sign(
          transcriptBytes,
          keyPair: staticKeyPair,
        );
        write(ourSignature.bytes);
        await flush();
      } else {
        await _expectVersion(reader);
        peerEphemeral = await reader.readExactly(x25519KeyLength);
        peerStatic = await reader.readExactly(ed25519KeyLength);

        transcriptBytes = _transcript(
          dialerEphemeral: peerEphemeral,
          dialerStatic: peerStatic,
          listenerEphemeral: ephemeralBytes,
          listenerStatic: staticPublicBytes,
        );

        final ourSignature = await _ed25519.sign(
          transcriptBytes,
          keyPair: staticKeyPair,
        );
        write(<int>[handshakeVersion]);
        write(ephemeralBytes);
        write(staticPublicBytes);
        write(ourSignature.bytes);
        await flush();

        final peerSignature = await reader.readExactly(ed25519SignatureLength);
        await _requireSignature(
          transcriptBytes: transcriptBytes,
          signature: peerSignature,
          peerStatic: peerStatic,
        );
      }

      final shared = await _x25519.sharedSecretKey(
        keyPair: ephemeral,
        remotePublicKey: SimplePublicKey(
          peerEphemeral,
          type: KeyPairType.x25519,
        ),
      );

      final keys = await _deriveKeys(shared, transcriptBytes);
      final dialerToListener = SecretKey(keys.sublist(0, 32));
      final listenerToDialer = SecretKey(keys.sublist(32, 64));

      return SecureChannel._(
        reader: reader,
        write: write,
        flush: flush,
        peerStaticPublicKey: peerStatic,
        sendKey: isDialer ? dialerToListener : listenerToDialer,
        recvKey: isDialer ? listenerToDialer : dialerToListener,
      );
    } catch (_) {
      await reader.cancel();
      rethrow;
    }
  }

  static Future<void> _expectVersion(_ByteReader reader) async {
    final version = await reader.readExactly(1);
    if (version[0] != handshakeVersion) {
      throw HandshakeException('unsupported handshake version ${version[0]}');
    }
  }

  static Future<void> _requireSignature({
    required Uint8List transcriptBytes,
    required Uint8List signature,
    required Uint8List peerStatic,
  }) async {
    if (peerStatic.length != ed25519KeyLength) {
      throw const HandshakeException('malformed peer static key');
    }
    final valid = await _ed25519.verify(
      transcriptBytes,
      signature: Signature(
        signature,
        publicKey: SimplePublicKey(peerStatic, type: KeyPairType.ed25519),
      ),
    );
    if (!valid) {
      throw const HandshakeException('peer failed to prove key possession');
    }
  }

  static Uint8List _transcript({
    required Uint8List dialerEphemeral,
    required Uint8List dialerStatic,
    required Uint8List listenerEphemeral,
    required Uint8List listenerStatic,
  }) {
    final out = BytesBuilder(copy: false)
      ..add(utf8.encode(transcriptLabel))
      ..add(dialerEphemeral)
      ..add(dialerStatic)
      ..add(listenerEphemeral)
      ..add(listenerStatic);
    return out.toBytes();
  }

  /// HKDF-SHA256 (RFC 5869) over the ephemeral shared secret.
  ///
  /// Written out rather than taken from a KDF helper so the key schedule stays
  /// auditable in one place and provably identical to the desktop agent's.
  static Future<Uint8List> _deriveKeys(
    SecretKey shared,
    Uint8List transcriptBytes,
  ) async {
    final salt = (await Sha256().hash(transcriptBytes)).bytes;
    final secretBytes = await shared.extractBytes();

    // Extract.
    final prk = (await _hmacSha256.calculateMac(
      secretBytes,
      secretKey: SecretKey(salt),
    )).bytes;

    // Expand.
    final info = utf8.encode(keyLabel);
    final out = BytesBuilder(copy: false);
    var block = <int>[];
    for (var counter = 1; out.length < 64; counter++) {
      final input = BytesBuilder(copy: false)
        ..add(block)
        ..add(info)
        ..addByte(counter);
      block = (await _hmacSha256.calculateMac(
        input.toBytes(),
        secretKey: SecretKey(prk),
      )).bytes;
      out.add(block);
    }
    return Uint8List.fromList(out.toBytes().sublist(0, 64));
  }

  /// Nonce layout matches the desktop agent: four zero bytes then a big-endian
  /// counter. Keys are per-direction and per-connection, so a counter is never
  /// reused under one key.
  static Uint8List _nonceFor(int sequence) {
    final nonce = Uint8List(nonceLength);
    ByteData.view(nonce.buffer).setUint64(4, sequence, Endian.big);
    return nonce;
  }

  /// Encrypts and writes one frame.
  Future<void> send(List<int> plaintext) async {
    if (_closed) throw StateError('channel is closed');

    final box = await _aesGcm.encrypt(
      plaintext,
      secretKey: _sendKey,
      nonce: _nonceFor(_sendSequence),
    );
    _sendSequence++;

    final sealed = BytesBuilder(copy: false)
      ..add(box.cipherText)
      ..add(box.mac.bytes);
    final body = sealed.toBytes();
    if (body.length > maxFrameSize) {
      throw const FrameException('frame exceeds maximum size');
    }

    final header = Uint8List(4);
    ByteData.view(header.buffer).setUint32(0, body.length, Endian.big);
    _write(header);
    _write(body);
    await _flush();
  }

  /// Reads and authenticates one frame. Returns null on a clean peer close.
  Future<Uint8List?> receive() async {
    if (_closed) return null;

    final Uint8List header;
    try {
      header = await _reader.readExactly(4);
    } on _EndOfStream {
      return null;
    }

    final size = ByteData.view(
      header.buffer,
      header.offsetInBytes,
    ).getUint32(0, Endian.big);
    // Checked before allocating: a hostile length prefix must not let a peer
    // reserve gigabytes.
    if (size > maxFrameSize) {
      throw const FrameException('frame exceeds maximum size');
    }
    if (size < gcmTagLength) {
      throw const FrameException('frame is too short to be authenticated');
    }

    final sealed = await _reader.readExactly(size);
    final cipherText = sealed.sublist(0, size - gcmTagLength);
    final mac = Mac(sealed.sublist(size - gcmTagLength));

    final List<int> plaintext;
    try {
      plaintext = await _aesGcm.decrypt(
        SecretBox(cipherText, nonce: _nonceFor(_recvSequence), mac: mac),
        secretKey: _recvKey,
      );
    } on SecretBoxAuthenticationError {
      // Corruption or tampering. Both are fatal for this connection: once a
      // frame fails authentication the counter is no longer in step and any
      // later frame would be attacker-chosen.
      throw const FrameException('frame failed authentication');
    }
    _recvSequence++;
    return Uint8List.fromList(plaintext);
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await _reader.cancel();
  }
}

class HandshakeException implements Exception {
  final String message;
  const HandshakeException(this.message);
  @override
  String toString() => 'HandshakeException: $message';
}

class FrameException implements Exception {
  final String message;
  const FrameException(this.message);
  @override
  String toString() => 'FrameException: $message';
}

class _EndOfStream implements Exception {
  const _EndOfStream();
}

/// Turns a chunked byte stream into "read exactly n bytes".
///
/// Hand-rolled rather than pulled from a package: it is a few dozen lines, and
/// a transport that reads fixed-width cryptographic fields needs its framing to
/// be inspectable rather than inherited.
class _ByteReader {
  final Queue<Uint8List> _chunks = Queue<Uint8List>();
  int _available = 0;
  int _offset = 0;

  StreamSubscription<Uint8List>? _subscription;
  Completer<void>? _waiting;
  bool _done = false;
  Object? _error;

  _ByteReader(Stream<Uint8List> stream) {
    _subscription = stream.listen(
      (chunk) {
        if (chunk.isEmpty) return;
        _chunks.add(chunk);
        _available += chunk.length;
        _wake();
      },
      onError: (Object e) {
        _error = e;
        _wake();
      },
      onDone: () {
        _done = true;
        _wake();
      },
      cancelOnError: false,
    );
  }

  void _wake() {
    final waiting = _waiting;
    if (waiting != null && !waiting.isCompleted) {
      _waiting = null;
      waiting.complete();
    }
  }

  Future<Uint8List> readExactly(int n) async {
    while (_available < n) {
      if (_error != null) throw _error!;
      if (_done) throw const _EndOfStream();
      final waiting = _waiting ??= Completer<void>();
      await waiting.future;
    }

    final out = Uint8List(n);
    var written = 0;
    while (written < n) {
      final chunk = _chunks.first;
      final take = chunk.length - _offset < n - written
          ? chunk.length - _offset
          : n - written;
      out.setRange(written, written + take, chunk, _offset);
      written += take;
      _offset += take;
      if (_offset == chunk.length) {
        _chunks.removeFirst();
        _offset = 0;
      }
    }
    _available -= n;
    return out;
  }

  Future<void> cancel() async {
    await _subscription?.cancel();
    _subscription = null;
    _chunks.clear();
    _available = 0;
    _offset = 0;
  }
}
