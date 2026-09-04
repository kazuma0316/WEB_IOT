# WEB_IOT

## bluetoothの確認（raspberry pi）

raspberry piで
```text
bluetoothctl show
```

を実行して、`powered: yes`になっているか確認する。

`powered: no`の場合は
```text
bluetoothctl
power on
```
を入力すればbluetoothが起動すると思います。

## pcの環境構築

Node.jsを入れる（入っていない場合）

windowsのpowershellから

```text
winget install --id OpenJS.NodeJS.LTS
```

でインストールできます。

```text
node --version
npm --version
```
で入っているか確認できます。

## プログラムの運用方法

`WEB_IOT/raspberry_pi`フォルダ内の`advertise.sh`と`proximity.js`の中身をraspberry piのほうに移して下さい。

その際に、`advertise.sh`の` echo 'name "device-a"'`の部分と`proximity.js`の`const MY_DEVICE_ID = "device-a";`の部分に関しては、`device-a`の部分を２つのraspberry piで変えるようにしてください。

また、`proximity.js`の`const SERVER_URL = "http://192.168.1.145:3000/event";`はサーバーを立てるpcのipアドレスに変更してください。

pcのターミナル上で
```text
node server/server.js
```
でサーバーを立てることができます。webブラウザ上で`http://localhost:3000`をurl欄に入力すると立てたwebサーバにアクセスできます。

raspberry piのターミナル上で
```text
./advertise.sh
```
でbluetoothでのadvertiseを始められます。
```text
advertise.sh >advertise.log &
```
ターミナルを占有せずに実行できるので、正常に動くことが確認できたらこのコマンドで実行してください。

raspberry piのターミナルで
```text
node proximity.js
```
で実行するとbluetoothでの検出が始まります。うまく検出されると、pcで立てたwebでも見れると思います。
