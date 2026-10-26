import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:copy_and_paste/services/secure_channel.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';

/// One direction of an in-memory socket pair.
class _Pipe {
  final StreamController<Uint8List> controller = StreamController<Uint8List>();

  void write(List<int> bytes) => controller.add(Uint8List.fromList(bytes));

  Stream<Uint8List> get stream => controller.stream;

  Future<void> close() => controller.close();
}

Future<void> _noFlush() async {}

void main() {
  final ed25519 = Ed25519();

  group('SecureChannel handshake', () {
    test('establishes a channel and proves both identities', () async {
      final alice = await ed25519.newKeyPair();
      final bob = await ed25519.newKeyPair();

      final aToB = _Pipe();
      final bToA = _Pipe();

      final dialerFuture = SecureChannel.dial(
        incoming: bToA.stream,
        write: aToB.write,
        flush: _noFlush,
        staticKeyPair: alice,
      );
      final listenerFuture = SecureChannel.accept(
        incoming: aToB.stream,
        write: bToA.write,
        flush: _noFlush,
        staticKeyPair: bob,
      );

      final dialer = await dialerFuture;
      final listener = await listenerFuture;

      final alicePublic = await alice.extractPublicKey();
      final bobPublic = await bob.extractPublicKey();

      // Each side learns the peer's real static key, which is what the caller
      // then matches against the signed roster.
      expect(dialer.peerStaticPublicKey, equals(bobPublic.bytes));
      expect(listener.peerStaticPublicKey, equals(alicePublic.bytes));

      await dialer.close();
      await listener.close();
    });

    test('carries frames in both directions, in order', () async {
      final alice = await ed25519.newKeyPair();
      final bob = await ed25519.newKeyPair();
      final aToB = _Pipe();
      final bToA = _Pipe();

      final dialerFuture = SecureChannel.dial(
        incoming: bToA.stream,
        write: aToB.write,
        flush: _noFlush,
        staticKeyPair: alice,
      );
      final listenerFuture = SecureChannel.accept(
        incoming: aToB.stream,
        write: bToA.write,
        flush: _noFlush,
        staticKeyPair: bob,
      );
      final dialer = await dialerFuture;
      final listener = await listenerFuture;

      await dialer.send(utf8.encode('first'));
      await dialer.send(utf8.encode('second'));
      expect(utf8.decode((await listener.receive())!), 'first');
      expect(utf8.decode((await listener.receive())!), 'second');

      await listener.send(utf8.encode('reply'));
      expect(utf8.decode((await dialer.receive())!), 'reply');

      await dialer.close();
      await listener.close();
    });

    test('rejects a peer that cannot prove it holds the claimed key', () async {
      // The attacker claims the victim's identity but signs with its own key.
      final dialerKeys = await ed25519.newKeyPair();
      final victimKeys = await ed25519.newKeyPair();
      final attackerKeys = await ed25519.newKeyPair();

      final aToB = _Pipe();
      final bToA = _Pipe();

      final dialerFuture = SecureChannel.dial(
        incoming: bToA.stream,
        write: aToB.write,
        flush: _noFlush,
        staticKeyPair: dialerKeys,
      );

      // Hand-rolled hostile listener.
      final firstMessage = await _collect(aToB.stream, 1 + 32 + 32);
      final dialerEphemeral = firstMessage.sublist(1, 33);
      final dialerStatic = firstMessage.sublist(33, 65);

      final x25519 = X25519();
      final listenerEphemeral = await x25519.newKeyPair();
      final listenerEphemeralBytes =
          (await listenerEphemeral.extractPublicKey()).bytes;
      final victimStatic = (await victimKeys.extractPublicKey()).bytes;

      final transcript = BytesBuilder(copy: false)
        ..add(utf8.encode(SecureChannel.transcriptLabel))
        ..add(dialerEphemeral)
        ..add(dialerStatic)
        ..add(listenerEphemeralBytes)
        ..add(victimStatic);

      final forged = await ed25519.sign(
        transcript.toBytes(),
        keyPair: attackerKeys,
      );

      bToA.write(<int>[SecureChannel.handshakeVersion]);
      bToA.write(listenerEphemeralBytes);
      bToA.write(victimStatic);
      bToA.write(forged.bytes);

      await expectLater(dialerFuture, throwsA(isA<HandshakeException>()));
    });

    test('rejects an unsupported handshake version', () async {
      final keys = await ed25519.newKeyPair();
      final aToB = _Pipe();
      final bToA = _Pipe();

      final dialerFuture = SecureChannel.dial(
        incoming: bToA.stream,
        write: aToB.write,
        flush: _noFlush,
        staticKeyPair: keys,
      );

      bToA.write(<int>[99]);
      bToA.write(Uint8List(32));
      bToA.write(Uint8List(32));
      bToA.write(Uint8List(64));

      await expectLater(dialerFuture, throwsA(isA<HandshakeException>()));
    });
  });

  group('SecureChannel framing', () {
    test('a tampered frame fails authentication', () async {
      final alice = await ed25519.newKeyPair();
      final bob = await ed25519.newKeyPair();

      final toListener = _Pipe();
      final toDialer = _Pipe();

      // Once the handshake is done, hold the dialer's next frame back so a bit
      // can be flipped in it before the listener ever sees it.
      var intercepting = false;
      final intercepted = <int>[];

      final dialerFuture = SecureChannel.dial(
        incoming: toDialer.stream,
        write: (bytes) {
          if (intercepting) {
            intercepted.addAll(bytes);
          } else {
            toListener.write(bytes);
          }
        },
        flush: _noFlush,
        staticKeyPair: alice,
      );
      final listenerFuture = SecureChannel.accept(
        incoming: toListener.stream,
        write: toDialer.write,
        flush: _noFlush,
        staticKeyPair: bob,
      );
      final dialer = await dialerFuture;
      final listener = await listenerFuture;

      intercepting = true;
      await dialer.send(utf8.encode('secret payload'));
      expect(intercepted.length, greaterThan(4));

      final frame = Uint8List.fromList(intercepted);
      // Flip a bit of the GCM tag.
      frame[frame.length - 1] ^= 0xFF;

      intercepting = false;
      toListener.write(frame);

      await expectLater(listener.receive(), throwsA(isA<FrameException>()));

      await dialer.close();
      await listener.close();
    });

    test('rejects an oversized length prefix before allocating', () async {
      final alice = await ed25519.newKeyPair();
      final bob = await ed25519.newKeyPair();
      final aToB = _Pipe();
      final bToA = _Pipe();

      final dialerFuture = SecureChannel.dial(
        incoming: bToA.stream,
        write: aToB.write,
        flush: _noFlush,
        staticKeyPair: alice,
      );
      final listenerFuture = SecureChannel.accept(
        incoming: aToB.stream,
        write: bToA.write,
        flush: _noFlush,
        staticKeyPair: bob,
      );
      final dialer = await dialerFuture;
      final listener = await listenerFuture;

      final header = Uint8List(4);
      ByteData.view(header.buffer).setUint32(0, 0xFFFFFFF, Endian.big);
      bToA.write(header);

      await expectLater(dialer.receive(), throwsA(isA<FrameException>()));

      await dialer.close();
      await listener.close();
    });

    test('returns null on a clean peer close', () async {
      final alice = await ed25519.newKeyPair();
      final bob = await ed25519.newKeyPair();
      final aToB = _Pipe();
      final bToA = _Pipe();

      final dialerFuture = SecureChannel.dial(
        incoming: bToA.stream,
        write: aToB.write,
        flush: _noFlush,
        staticKeyPair: alice,
      );
      final listenerFuture = SecureChannel.accept(
        incoming: aToB.stream,
        write: bToA.write,
        flush: _noFlush,
        staticKeyPair: bob,
      );
      final dialer = await dialerFuture;
      final listener = await listenerFuture;

      await bToA.close();
      expect(await dialer.receive(), isNull);

      await listener.close();
    });
  });
}

/// Reads exactly [n] bytes off [stream] for the hand-rolled hostile peer.
Future<Uint8List> _collect(Stream<Uint8List> stream, int n) async {
  final out = BytesBuilder(copy: false);
  await for (final chunk in stream) {
    out.add(chunk);
    if (out.length >= n) break;
  }
  return Uint8List.fromList(out.toBytes().sublist(0, n));
}
