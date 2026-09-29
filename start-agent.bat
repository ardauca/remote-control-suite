@echo off
title Remote Control Suite - Windows Agent
cd /d "%~dp0publish"
echo =======================================================
echo    Remote Control Suite - Windows Agent v1.0.0
echo    Starting interactive GUI and System Tray Host...
echo =======================================================
start "" "RemoteAgent.exe"
