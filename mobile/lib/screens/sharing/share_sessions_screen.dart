import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'dart:developer' as developer;
import '../../services/auth_service.dart';
import '../../services/sharing_service.dart';
import '../../services/clipboard_sync_service.dart';

class ShareSessionsScreen extends StatefulWidget {
  const ShareSessionsScreen({super.key});

  @override
  State<ShareSessionsScreen> createState() => _ShareSessionsScreenState();
}

class _ShareSessionsScreenState extends State<ShareSessionsScreen> {
  List<ShareSession> _sessions = [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final authService = context.read<AuthService>();
      await authService.getStoredTokens();

      if (!mounted) return;
      final sharingService = context.read<SharingService>();
      final sessions = await sharingService.listSessions();
      if (mounted) {
        setState(() {
          _sessions = sessions;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceFirst('Exception: ', '');
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _handleCreateSession() async {
    int selectedDuration = 3600; // Default 1 hour

    await showCupertinoModalPopup<void>(
      context: context,
      builder: (BuildContext sheetContext) => CupertinoActionSheet(
        title: const Text('Create Temporary Share Session'),
        message: const Text(
          'Select session duration. Members will be able to exchange clipboard data until the session expires.',
        ),
        actions: <CupertinoActionSheetAction>[
          CupertinoActionSheetAction(
            child: const Text('1 Hour (Recommended)'),
            onPressed: () {
              selectedDuration = 3600;
              Navigator.pop(sheetContext);
              _performCreateSession(selectedDuration);
            },
          ),
          CupertinoActionSheetAction(
            child: const Text('4 Hours'),
            onPressed: () {
              selectedDuration = 14400;
              Navigator.pop(sheetContext);
              _performCreateSession(selectedDuration);
            },
          ),
          CupertinoActionSheetAction(
            child: const Text('24 Hours'),
            onPressed: () {
              selectedDuration = 86400;
              Navigator.pop(sheetContext);
              _performCreateSession(selectedDuration);
            },
          ),
        ],
        cancelButton: CupertinoActionSheetAction(
          isDefaultAction: true,
          onPressed: () => Navigator.pop(sheetContext),
          child: const Text('Cancel'),
        ),
      ),
    );
  }

  Future<void> _performCreateSession(int durationSeconds) async {
    setState(() => _isLoading = true);

    try {
      final sharingService = context.read<SharingService>();
      final session = await sharingService.createSession(
        CreateSessionRequest(expiresInSeconds: durationSeconds),
      );

      await _loadSessions();

      if (mounted && session.joinCode != null) {
        _showJoinCodeDialog(session.id, session.joinCode!);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Failed to create session: $e';
          _isLoading = false;
        });
      }
    }
  }

  void _showJoinCodeDialog(String sessionId, String joinCode) {
    showCupertinoDialog<void>(
      context: context,
      builder: (dialogContext) => CupertinoAlertDialog(
        title: const Text('Session Created!'),
        content: Column(
          children: [
            const SizedBox(height: 12),
            const Text(
              'Share this Join Code with others so they can join your session. It is shown only once:',
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: CupertinoColors.systemGrey6,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: CupertinoColors.systemGrey4),
              ),
              child: Text(
                joinCode,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 3,
                  fontFamily: 'monospace',
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Session ID: $sessionId',
              style: const TextStyle(
                fontSize: 11,
                color: CupertinoColors.systemGrey,
              ),
            ),
          ],
        ),
        actions: [
          CupertinoDialogAction(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: joinCode));
              Navigator.pop(dialogContext);
            },
            child: const Text('Copy Join Code'),
          ),
          CupertinoDialogAction(
            isDefaultAction: true,
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleJoinSessionDialog() async {
    final sessionIdController = TextEditingController();
    final joinCodeController = TextEditingController();

    await showCupertinoDialog<void>(
      context: context,
      builder: (dialogContext) => CupertinoAlertDialog(
        title: const Text('Join Share Session'),
        content: Column(
          children: [
            const SizedBox(height: 12),
            const Text('Enter the Session ID and 8-character Join Code:'),
            const SizedBox(height: 12),
            CupertinoTextField(
              controller: sessionIdController,
              placeholder: 'Session ID (cp_ses_...)',
              autocorrect: false,
            ),
            const SizedBox(height: 8),
            CupertinoTextField(
              controller: joinCodeController,
              placeholder: 'Join Code (8 characters)',
              autocorrect: false,
              textCapitalization: TextCapitalization.characters,
            ),
          ],
        ),
        actions: [
          CupertinoDialogAction(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          CupertinoDialogAction(
            isDefaultAction: true,
            onPressed: () {
              final sid = sessionIdController.text.trim();
              final code = joinCodeController.text.trim();
              if (sid.isNotEmpty && code.isNotEmpty) {
                Navigator.pop(dialogContext);
                _performJoinSession(sid, code);
              }
            },
            child: const Text('Join'),
          ),
        ],
      ),
    );
  }

  Future<void> _performJoinSession(String sessionId, String joinCode) async {
    setState(() => _isLoading = true);
    try {
      final sharingService = context.read<SharingService>();
      await sharingService.joinSession(sessionId, joinCode);

      // Set active session in clipboard sync
      final clipboardSync = context.read<ClipboardSyncService>();
      final session = await sharingService.getSession(sessionId);

      // Extract member user IDs as peer identifiers
      final memberIds = session.members
          .map((m) => m.userId)
          .whereType<String>()
          .toList();
      clipboardSync.setActiveSession(sessionId, memberIds);

      developer.log(
        'Joined session $sessionId with ${memberIds.length} members',
      );
      await _loadSessions();
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Failed to join session: $e';
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _confirmLeaveSession(ShareSession session) async {
    final confirm = await showCupertinoDialog<bool>(
      context: context,
      builder: (dialogContext) => CupertinoAlertDialog(
        title: const Text('Leave Session?'),
        content: Text(
          'You will no longer share or receive clipboard updates from this session (${session.id}).',
        ),
        actions: [
          CupertinoDialogAction(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          CupertinoDialogAction(
            isDestructiveAction: true,
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      final sharingService = context.read<SharingService>();
      final clipboardSync = context.read<ClipboardSyncService>();
      setState(() => _isLoading = true);
      try {
        await sharingService.leaveSession(session.id);

        // Clear active session if leaving current session
        if (clipboardSync.activeSessionId == session.id) {
          clipboardSync.setActiveSession(null, []);
          developer.log('Cleared active session: ${session.id}');
        }

        await _loadSessions();
      } catch (e) {
        if (mounted) {
          setState(() {
            _errorMessage = 'Failed to leave session: $e';
            _isLoading = false;
          });
        }
      }
    }
  }

  Future<void> _confirmExpireSession(ShareSession session) async {
    final confirm = await showCupertinoDialog<bool>(
      context: context,
      builder: (dialogContext) => CupertinoAlertDialog(
        title: const Text('End Share Session?'),
        content: const Text(
          'As the owner, ending this session will immediately disconnect all members and revoke sharing.',
        ),
        actions: [
          CupertinoDialogAction(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          CupertinoDialogAction(
            isDestructiveAction: true,
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('End Session'),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      final sharingService = context.read<SharingService>();
      final clipboardSync = context.read<ClipboardSyncService>();
      setState(() => _isLoading = true);
      try {
        await sharingService.expireSession(session.id);

        // Clear active session if expiring current session
        if (clipboardSync.activeSessionId == session.id) {
          clipboardSync.setActiveSession(null, []);
          developer.log('Cleared active session: ${session.id}');
        }

        await _loadSessions();
      } catch (e) {
        if (mounted) {
          setState(() {
            _errorMessage = 'Failed to end session: $e';
            _isLoading = false;
          });
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      navigationBar: CupertinoNavigationBar(
        middle: const Text('Share Sessions'),
        previousPageTitle: 'Back',
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            CupertinoButton(
              padding: EdgeInsets.zero,
              onPressed: _handleJoinSessionDialog,
              child: const Text('Join'),
            ),
            const SizedBox(width: 8),
            CupertinoButton(
              padding: EdgeInsets.zero,
              onPressed: _handleCreateSession,
              child: const Icon(CupertinoIcons.add),
            ),
          ],
        ),
      ),
      child: SafeArea(
        child: _isLoading
            ? const Center(child: CupertinoActivityIndicator())
            : CustomScrollView(
                slivers: [
                  CupertinoSliverRefreshControl(onRefresh: _loadSessions),
                  if (_errorMessage != null)
                    SliverToBoxAdapter(
                      child: Container(
                        margin: const EdgeInsets.all(16),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: CupertinoColors.destructiveRed.withValues(
                            alpha: 0.1,
                          ),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: CupertinoColors.destructiveRed,
                          ),
                        ),
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(
                            color: CupertinoColors.destructiveRed,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  if (_sessions.isEmpty)
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(
                                CupertinoIcons.person_2_square_stack,
                                size: 64,
                                color: CupertinoColors.systemGrey,
                              ),
                              const SizedBox(height: 16),
                              const Text(
                                'No Active Share Sessions',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 8),
                              const Text(
                                'Share sessions allow you to securely sync clipboard items with nearby peers temporarily.',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: CupertinoColors.systemGrey,
                                ),
                              ),
                              const SizedBox(height: 24),
                              CupertinoButton.filled(
                                onPressed: _handleCreateSession,
                                child: const Text('Create Share Session'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    )
                  else
                    SliverList(
                      delegate: SliverChildBuilderDelegate((context, index) {
                        final session = _sessions[index];
                        return _buildSessionCard(session);
                      }, childCount: _sessions.length),
                    ),
                ],
              ),
      ),
    );
  }

  Widget _buildSessionCard(ShareSession session) {
    final isActive = session.isActive;
    final expiresFormatted = session.expiresAt.toLocal().toString().substring(
      0,
      16,
    );

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: CupertinoColors.systemBackground.resolveFrom(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isActive
              ? CupertinoColors.systemBlue.withValues(alpha: 0.3)
              : CupertinoColors.systemGrey4,
        ),
        boxShadow: [
          BoxShadow(
            color: CupertinoColors.systemGrey.withValues(alpha: 0.1),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(
                    isActive
                        ? CupertinoIcons.check_mark_circled_solid
                        : CupertinoIcons.clear_circled_solid,
                    color: isActive
                        ? CupertinoColors.activeGreen
                        : CupertinoColors.systemGrey,
                    size: 18,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    isActive ? 'ACTIVE' : session.status.toUpperCase(),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: isActive
                          ? CupertinoColors.activeGreen
                          : CupertinoColors.systemGrey,
                    ),
                  ),
                ],
              ),
              Text(
                'Expires: $expiresFormatted',
                style: const TextStyle(
                  fontSize: 12,
                  color: CupertinoColors.systemGrey,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Text(
                  'ID: ${session.id}',
                  style: const TextStyle(
                    fontSize: 13,
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w600,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              CupertinoButton(
                padding: EdgeInsets.zero,
                minimumSize: const Size(24, 24),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: session.id));
                },
                child: const Icon(CupertinoIcons.doc_on_doc, size: 16),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Members (${session.members.length}):',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          ...session.members.map(
            (m) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Text(
                    m.isOwner ? '👑 ' : '👤 ',
                    style: const TextStyle(fontSize: 12),
                  ),
                  Expanded(
                    child: Text(
                      m.email.isNotEmpty ? m.email : m.userId,
                      style: const TextStyle(fontSize: 12),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    m.role,
                    style: TextStyle(
                      fontSize: 11,
                      color: m.isOwner
                          ? CupertinoColors.activeOrange
                          : CupertinoColors.systemGrey,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Divider(height: 1, color: CupertinoColors.systemGrey5),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              CupertinoButton(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                color: CupertinoColors.destructiveRed.withValues(alpha: 0.1),
                onPressed: () => _confirmLeaveSession(session),
                child: const Text(
                  'Leave Session',
                  style: TextStyle(
                    color: CupertinoColors.destructiveRed,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              CupertinoButton(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                color: CupertinoColors.systemGrey5,
                onPressed: () => _confirmExpireSession(session),
                child: const Text(
                  'End Sharing',
                  style: TextStyle(
                    color: CupertinoColors.label,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class Divider extends StatelessWidget {
  final double height;
  final Color color;

  const Divider({super.key, this.height = 1, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(height: height, color: color);
  }
}
