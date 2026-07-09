#!/bin/bash
# 配置 Android 前台服务（后台保活定位）
# 在 npx cap sync 之后执行
# CI 中也会自动调用

set -e

MANIFEST="android/app/src/main/AndroidManifest.xml"

# 1. 添加前台服务权限（如未添加）
if ! grep -q "FOREGROUND_SERVICE_LOCATION" "$MANIFEST"; then
  sed -i '/<\/manifest>/i \ \ \ \ <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />' "$MANIFEST"
  sed -i '/<\/manifest>/i \ \ \ \ <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />' "$MANIFEST"
  echo "+ FOREGROUND_SERVICE 权限"
fi
if ! grep -q "WAKE_LOCK" "$MANIFEST"; then
  sed -i '/<\/manifest>/i \ \ \ \ <uses-permission android:name="android.permission.WAKE_LOCK" />' "$MANIFEST"
  echo "+ WAKE_LOCK 权限"
fi
if ! grep -q "POST_NOTIFICATIONS" "$MANIFEST"; then
  sed -i '/<\/manifest>/i \ \ \ \ <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />' "$MANIFEST"
  echo "+ POST_NOTIFICATIONS 权限"
fi
if ! grep -q "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" "$MANIFEST"; then
  sed -i '/<\/manifest>/i \ \ \ \ <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />' "$MANIFEST"
  echo "+ REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限"
fi

# 2. 添加前景服务声明（如未添加）
if ! grep -q "com.getcapacitor.android.ForegroundService" "$MANIFEST"; then
  sed -i '/<application/a\ \ \ \ \ \ \ \ <service android:name="com.getcapacitor.android.ForegroundService" android:foregroundServiceType="location" android:exported="false" />' "$MANIFEST"
  echo "+ ForegroundService 声明"
fi

# 3. 创建通知图标（如不存在）
ICON_DIR="android/app/src/main/res/drawable"
ICON_FILE="$ICON_DIR/ic_notification.xml"
mkdir -p "$ICON_DIR"

if [ ! -f "$ICON_FILE" ]; then
  cat > "$ICON_FILE" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M12,2C8.13,2 5,5.13 5,9c0,5.25 7,13 7,13s7,-7.75 7,-13  -3.13,-7 -7,-7zM12,11.5c-1.38,0 -2.5,-1.12 -2.5,-2.5s1.12,-2.5 2.5,-2.5 2.5,1.12 2.5,2.5 -1.12,2.5 -2.5,2.5z"/>
</vector>
EOF
  echo "+ ic_notification.xml 图标"
fi

echo "✓ 前台服务配置完成"
