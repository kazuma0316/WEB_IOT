#!/bin/bash

{
    echo "power on"
    sleep 1

    echo "menu advertise"
    sleep 1

    echo "uuids 8f3a2c10-7b21-4e58-9a65-21c489d87f01"
    sleep 1

    echo 'name "device-a"'
    sleep 1

    echo "discoverable on"
    sleep 1

    echo "back"
    sleep 1

    echo "advertise on"
    sleep 1

    sleep infinity

} | bluetoothctl