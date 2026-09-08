package discovery

import (
	"net/netip"
	"strings"
	"testing"
)

func TestEncodeDecodeName(t *testing.T) {
	for _, name := range []string{
		"_codepaste._tcp.local",
		"agent-1._codepaste._tcp.local",
		"host.local",
	} {
		encoded, err := encodeName(nil, name)
		if err != nil {
			t.Fatalf("encode %q: %v", name, err)
		}
		got, next, err := decodeName(encoded, 0)
		if err != nil {
			t.Fatalf("decode %q: %v", name, err)
		}
		if got != name {
			t.Errorf("round trip: got %q, want %q", got, name)
		}
		if next != len(encoded) {
			t.Errorf("offset: got %d, want %d", next, len(encoded))
		}
	}
}

func TestEncodeNameRejectsAnOverlongLabel(t *testing.T) {
	if _, err := encodeName(nil, strings.Repeat("a", 64)+".local"); err == nil {
		t.Fatal("expected an error for a 64-character label")
	}
}

// A packet whose compression pointer loops must be rejected, not followed
// forever — this is a classic parser denial-of-service.
func TestDecodeNameRejectsAPointerLoop(t *testing.T) {
	// Offset 0 points at offset 0.
	msg := []byte{0xC0, 0x00}
	if _, _, err := decodeName(msg, 0); err == nil {
		t.Fatal("expected an error for a self-referential pointer")
	}
}

func TestDecodeNameRejectsAPointerPastTheEnd(t *testing.T) {
	msg := []byte{0xC0, 0xFF}
	if _, _, err := decodeName(msg, 0); err == nil {
		t.Fatal("expected an error for an out-of-range pointer")
	}
}

func TestDecodeMessageRejectsATruncatedHeader(t *testing.T) {
	if _, err := decodeMessage([]byte{1, 2, 3}); err == nil {
		t.Fatal("expected an error for a short message")
	}
}

// An announcement must survive its own encode/decode, or peers never see it.
func TestAnnouncementRoundTrips(t *testing.T) {
	m := NewMDNS("cp-dev-test")
	m.fingerprint = "sha256:" + strings.Repeat("ab", 32)
	m.port = 47800

	packet, err := m.announcementFor(netip.MustParseAddr("192.168.1.10"))
	if err != nil {
		t.Skipf("no usable interface in this environment: %v", err)
	}

	msg, err := decodeMessage(packet)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !msg.response {
		t.Error("an announcement must be marked as a response")
	}

	var sawPTR, sawSRV, sawTXT, sawA bool
	for _, rec := range msg.answers {
		switch rec.rtype {
		case typePTR:
			sawPTR = true
			if !strings.HasPrefix(rec.target, "cp-dev-test.") {
				t.Errorf("PTR target = %q", rec.target)
			}
		case typeSRV:
			sawSRV = true
			if rec.port != 47800 {
				t.Errorf("SRV port = %d, want 47800", rec.port)
			}
		case typeTXT:
			sawTXT = true
			if len(rec.txt) == 0 || !strings.HasPrefix(rec.txt[0], "fp=sha256:") {
				t.Errorf("TXT = %v", rec.txt)
			}
		case typeA:
			sawA = true
			if !rec.addr.IsValid() {
				t.Error("A record has no address")
			}
		}
	}
	if !sawPTR || !sawSRV || !sawTXT || !sawA {
		t.Errorf("missing records: ptr=%v srv=%v txt=%v a=%v", sawPTR, sawSRV, sawTXT, sawA)
	}
}

// An agent must not treat its own announcement as a peer, or it would try to
// connect to itself on every discovery round.
func TestCandidatesFromIgnoresOurOwnAnnouncement(t *testing.T) {
	m := NewMDNS("cp-dev-self")
	m.fingerprint = "sha256:aa"
	m.port = 47800

	packet, err := m.announcementFor(netip.MustParseAddr("192.168.1.10"))
	if err != nil {
		t.Skipf("no usable interface: %v", err)
	}
	msg, err := decodeMessage(packet)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got := m.candidatesFrom(msg, nil); len(got) != 0 {
		t.Fatalf("expected our own announcement to be ignored, got %+v", got)
	}
}

func TestCandidatesFromReadsAPeerAnnouncement(t *testing.T) {
	peer := NewMDNS("cp-dev-peer")
	peer.fingerprint = "sha256:" + strings.Repeat("cd", 32)
	peer.port = 47801

	packet, err := peer.announcementFor(netip.MustParseAddr("192.168.1.11"))
	if err != nil {
		t.Skipf("no usable interface: %v", err)
	}
	msg, err := decodeMessage(packet)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	// A different agent parses it.
	us := NewMDNS("cp-dev-us")
	got := us.candidatesFrom(msg, nil)
	if len(got) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(got))
	}
	if got[0].Addr.Port() != 47801 {
		t.Errorf("port = %d, want 47801", got[0].Addr.Port())
	}
	if got[0].KeyFingerprint != peer.fingerprint {
		t.Errorf("fingerprint = %q", got[0].KeyFingerprint)
	}
}

func TestSanitiseInstance(t *testing.T) {
	cases := map[string]string{
		"cp_dev_01h2xcejqtf2":   "cp-dev-01h2xcejqtf2",
		"":                      "codepaste",
		"has spaces and.dots":   "has-spaces-and-dots",
		strings.Repeat("x", 80): strings.Repeat("x", 40),
	}
	for in, want := range cases {
		if got := sanitiseInstance(in); got != want {
			t.Errorf("sanitiseInstance(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseStatic(t *testing.T) {
	static, err := ParseStatic("127.0.0.1:47800, 192.168.1.5:47801 ,")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if static.Len() != 2 {
		t.Fatalf("len = %d, want 2", static.Len())
	}

	if _, err := ParseStatic("not-an-address"); err == nil {
		t.Error("expected an error for a malformed address")
	}

	empty, err := ParseStatic("")
	if err != nil || empty.Len() != 0 {
		t.Errorf("an empty list is valid (accept-only): %v, len=%d", err, empty.Len())
	}
}

func TestStaticBrowseEmitsConfiguredPeers(t *testing.T) {
	static, err := ParseStatic("127.0.0.1:47800")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	ctx, cancel := contextWithTimeout(t)
	defer cancel()

	candidates, err := static.Browse(ctx)
	if err != nil {
		t.Fatalf("browse: %v", err)
	}

	select {
	case got := <-candidates:
		want := netip.MustParseAddrPort("127.0.0.1:47800")
		if got.Addr != want {
			t.Errorf("addr = %v, want %v", got.Addr, want)
		}
		// A configured address makes no identity claim at all.
		if got.KeyFingerprint != "" {
			t.Errorf("a static peer must not claim a fingerprint, got %q", got.KeyFingerprint)
		}
	case <-ctx.Done():
		t.Fatal("no candidate emitted")
	}
}
