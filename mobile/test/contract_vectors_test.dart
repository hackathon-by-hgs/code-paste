import 'dart:convert';
import 'dart:io';

import 'package:copy_and_paste/models/clipboard_event.dart';
import 'package:flutter_test/flutter_test.dart';

/// Conformance against the pinned contract vectors.
///
/// `contracts/vectors/invalid/` is the security surface: oversized payloads,
/// bad hashes, unknown content types, spoofed sender ids. Every one of them
/// must be rejected, and four of them are *accepted by JSON Schema alone* —
/// they exist precisely to prove the semantic layer is present.
///
/// The directory is the pinned copy fetched from `main` by CI
/// (`CONTRACTS_VERSION`), never a copy committed to this branch.
Directory _resolveVectors() {
  const candidates = <String>[
    '../.contracts/contracts/vectors',
    '.contracts/contracts/vectors',
  ];
  for (final path in candidates) {
    final dir = Directory(path);
    if (dir.existsSync()) return dir;
  }
  fail(
    'Pinned contract vectors not found. Fetch them first:\n'
    '  contract_ref="\$(cat CONTRACTS_VERSION)"\n'
    '  git fetch origin "\$contract_ref" --depth=1\n'
    '  mkdir -p .contracts && git archive FETCH_HEAD contracts | tar -x -C .contracts\n'
    'Looked in: ${candidates.join(', ')}',
  );
}

List<Map<String, dynamic>> _load(Directory vectors, String kind) {
  final dir = Directory('${vectors.path}/$kind');
  final files =
      dir
          .listSync()
          .whereType<File>()
          .where((f) => f.path.endsWith('.json'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));

  return files
      .map((f) => jsonDecode(f.readAsStringSync()) as Map<String, dynamic>)
      .toList();
}

void main() {
  final vectors = _resolveVectors();

  group('contract vectors', () {
    test('accepts every valid vector', () {
      final cases = _load(vectors, 'valid');

      // A fetch that silently produced nothing must not read as success.
      expect(cases, isNotEmpty, reason: 'no valid vectors were loaded');

      for (final vector in cases) {
        final name = vector['name'];
        final event = vector['event'] as Map<String, dynamic>;

        final decoded = ClipboardEvent.decode(event);

        expect(
          decoded.size,
          event['size'],
          reason: 'vector "$name": declared size should round-trip',
        );
        expect(
          decoded.hash,
          event['hash'],
          reason: 'vector "$name": hash should round-trip',
        );
      }
    });

    test('rejects every invalid vector', () {
      final cases = _load(vectors, 'invalid');
      expect(cases, isNotEmpty, reason: 'no invalid vectors were loaded');

      for (final vector in cases) {
        final name = vector['name'];
        final event = vector['event'] as Map<String, dynamic>;

        expect(
          () => ClipboardEvent.decode(event),
          throwsA(isA<EventRejectedException>()),
          reason: 'vector "$name" (${vector['rejectedBy']}) must be rejected',
        );
      }
    });

    test('rejects the four vectors JSON Schema alone would accept', () {
      final semantic = _load(
        vectors,
        'invalid',
      ).where((v) => v['rejectedBy'] == 'semantic').toList();

      // If this count changes, the contract gained or lost a semantic case and
      // this implementation needs revisiting rather than the number bumping.
      expect(semantic, hasLength(4));

      for (final vector in semantic) {
        expect(
          () => ClipboardEvent.decode(vector['event'] as Map<String, dynamic>),
          throwsA(isA<EventRejectedException>()),
          reason: 'semantic vector "${vector['name']}" must be rejected',
        );
      }
    });

    test('honours the roster limits rather than a hardcoded ceiling', () {
      // A 2 KiB text payload is fine by default and refused once the control
      // plane publishes a 1 KiB text limit.
      final payload = 'x' * 2048;
      final event = ClipboardEvent.create(
        senderDeviceId: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41',
        sequence: 1,
        contentType: ContentType.textPlain,
        payload: payload,
      );

      expect(event.isValidUnder(const PayloadLimits()), isTrue);
      expect(
        event.isValidUnder(
          PayloadLimits.fromRoster(const <String, int>{'text/plain': 1024}),
        ),
        isFalse,
      );
    });
  });
}
